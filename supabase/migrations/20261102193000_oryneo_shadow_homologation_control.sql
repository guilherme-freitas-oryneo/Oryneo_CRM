-- Safe operator control for ORYNEO's non-emitting shadow homologation.
-- It never transfers channel ownership, enables a flow or authorizes dispatch.

CREATE OR REPLACE FUNCTION public.automation_shadow_control(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_enable boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
  v_mode text;
  v_stop boolean;
  v_active boolean;
  v_stream text;
  v_flow_count integer;
BEGIN
  IF p_enable IS NULL THEN
    RAISE EXCEPTION 'SHADOW_CONTROL_INVALID' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.automation_workspace_members m
    JOIN public.crm_members crm ON crm.user_id=m.user_id
    WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id AND m.role='admin'
  ) THEN
    RAISE EXCEPTION 'SHADOW_ADMIN_REQUIRED' USING ERRCODE='42501';
  END IF;

  PERFORM 1 FROM public.automation_workspaces
    WHERE id=p_workspace_id AND slug='oryneo-crm' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHADOW_WORKSPACE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  PERFORM 1 FROM public.automation_runtime_settings
    WHERE workspace_id=p_workspace_id FOR UPDATE;

  SELECT s.mode,s.emergency_stop,w.active INTO v_mode,v_stop,v_active
  FROM public.automation_runtime_settings s
  JOIN public.automation_workspaces w ON w.id=s.workspace_id
  WHERE s.workspace_id=p_workspace_id;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'SHADOW_RUNTIME_NOT_FOUND' USING ERRCODE='P0002';
  END IF;

  IF NOT p_enable THEN
    UPDATE public.automation_runtime_settings SET
      mode='disabled',emergency_stop=true,updated_by=p_actor_id,updated_at=clock_timestamp()
      WHERE workspace_id=p_workspace_id;
    UPDATE public.automation_workspaces SET active=false
      WHERE id=p_workspace_id;
    INSERT INTO public.automation_audit_log
      (workspace_id,actor_id,action,target_type,target_id,summary)
    VALUES(p_workspace_id,p_actor_id,'shadow_homologation_stopped','workspace',p_workspace_id,
      jsonb_build_object('mode','disabled','dispatchAuthorized',false));
    RETURN jsonb_build_object('mode','disabled','emergencyStop',true,
      'workspaceActive',false,'shadowOnly',true,'dispatchAuthorized',false);
  END IF;

  IF v_mode='shadow' AND NOT v_stop AND v_active THEN
    RETURN jsonb_build_object('mode','shadow','emergencyStop',false,
      'workspaceActive',true,'shadowOnly',true,'dispatchAuthorized',false,
      'alreadyRunning',true);
  END IF;

  IF v_mode<>'disabled' OR NOT v_stop OR v_active THEN
    RAISE EXCEPTION 'SHADOW_SAFE_START_REQUIRED' USING ERRCODE='42501';
  END IF;
  SELECT count(*) INTO v_flow_count FROM public.automation_flows
    WHERE workspace_id=p_workspace_id;
  IF v_flow_count=0 OR EXISTS(
    SELECT 1 FROM public.automation_flows f
    LEFT JOIN public.automation_flow_versions v
      ON v.id=f.published_version_id AND v.workspace_id=f.workspace_id
    WHERE f.workspace_id=p_workspace_id
      AND (f.enabled OR f.published_version_id IS NULL OR v.status IS DISTINCT FROM 'published')
  ) THEN
    RAISE EXCEPTION 'SHADOW_FROZEN_FLOWS_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.automation_channel_ownership
    WHERE workspace_id=p_workspace_id AND owner<>'legacy'
  ) OR (SELECT count(*) FROM public.automation_channel_ownership
        WHERE workspace_id=p_workspace_id)<>5 THEN
    RAISE EXCEPTION 'SHADOW_LEGACY_OWNERSHIP_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.automation_action_outbox
    WHERE workspace_id=p_workspace_id AND state IN ('queued','leased','uncertain')
  ) THEN
    RAISE EXCEPTION 'SHADOW_OUTBOX_MUST_BE_EMPTY' USING ERRCODE='42501';
  END IF;

  -- Cursor functions deliberately require the hard-stop state above. Existing
  -- cursors are never rewound, so restarting shadow does not replay history.
  PERFORM public.automation_shadow_init_crm_cursor(p_workspace_id,p_actor_id);
  PERFORM public.automation_shadow_init_whatsapp_cursor(p_workspace_id,p_actor_id);
  FOREACH v_stream IN ARRAY ARRAY[
    'intake','checkout','billing','mail','delivery','proposal','meeting','handoff'
  ] LOOP
    PERFORM public.automation_commercial_init_cursor(p_workspace_id,p_actor_id,v_stream);
  END LOOP;

  UPDATE public.automation_workspaces SET active=true
    WHERE id=p_workspace_id;
  UPDATE public.automation_runtime_settings SET
    mode='shadow',emergency_stop=false,updated_by=p_actor_id,updated_at=clock_timestamp()
    WHERE workspace_id=p_workspace_id;
  INSERT INTO public.automation_audit_log
    (workspace_id,actor_id,action,target_type,target_id,summary)
  VALUES(p_workspace_id,p_actor_id,'shadow_homologation_started','workspace',p_workspace_id,
    jsonb_build_object('mode','shadow','flows',v_flow_count,
      'channelOwner','legacy','dispatchAuthorized',false));
  RETURN jsonb_build_object('mode','shadow','emergencyStop',false,
    'workspaceActive',true,'shadowOnly',true,'dispatchAuthorized',false,
    'publishedFlows',v_flow_count);
END $fn$;

REVOKE ALL ON FUNCTION public.automation_shadow_control(uuid,uuid,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_shadow_control(uuid,uuid,boolean)
  TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $cleanup$
DECLARE existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job FROM cron.job
    WHERE jobname='crm-automation-shadow-every-minute';
  IF existing_job IS NOT NULL THEN PERFORM cron.unschedule(existing_job); END IF;
END
$cleanup$;

-- The HTTP request is created only while the explicit shadow gate is active.
-- Disabled mode therefore produces no idle Edge Function invocations.
SELECT cron.schedule(
  'crm-automation-shadow-every-minute',
  '* * * * *',
  $job$
    SELECT net.http_post(
      url := 'https://ucikrafwfzamxvweuvgk.supabase.co/functions/v1/automation-shadow-worker',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'x-oryneo-cron',(SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name='oryneo_mail_cron_token')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    )
    WHERE EXISTS(
      SELECT 1 FROM public.automation_workspaces w
      JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
      WHERE w.slug='oryneo-crm' AND w.active
        AND s.mode='shadow' AND NOT s.emergency_stop
    )
  $job$
);
