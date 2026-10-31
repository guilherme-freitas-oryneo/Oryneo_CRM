-- Macroetapa 6: explicit live CRM cursor and bounded failure recovery.
-- Review/CI preview ONLY. Never initialize at deploy; initialization requires
-- authorized human and stopped runtime. No retroactive replay or sends.
BEGIN;
CREATE TABLE IF NOT EXISTS public.automation_live_crm_cursors(
 workspace_id uuid PRIMARY KEY REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 last_at timestamptz NOT NULL, last_id uuid NOT NULL,
 initialized_by uuid NOT NULL, initialized_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.automation_live_crm_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_live_crm_cursors FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.automation_live_crm_cursors TO service_role;
CREATE OR REPLACE FUNCTION public.automation_live_crm_init_cursor(
 p_workspace_id uuid,p_actor_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE anchor timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
 JOIN public.automation_workspace_members m ON m.workspace_id=w.id
 JOIN public.crm_members c ON c.user_id=m.user_id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND NOT w.active
 AND s.mode='disabled' AND s.emergency_stop
 AND m.user_id=p_actor_id AND m.role='admin')
 THEN RAISE EXCEPTION 'LIVE_CRM_CURSOR_BOOTSTRAP_DENIED' USING ERRCODE='42501'; END IF;
 INSERT INTO public.automation_live_crm_cursors
 (workspace_id,last_at,last_id,initialized_by)
 VALUES(p_workspace_id,clock_timestamp(),'00000000-0000-0000-0000-000000000000',p_actor_id)
 ON CONFLICT(workspace_id) DO NOTHING;
 SELECT last_at INTO anchor FROM public.automation_live_crm_cursors
 WHERE workspace_id=p_workspace_id;
 RETURN anchor;
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_live_crm_poll(
 p_workspace_id uuid,p_limit integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE cursor_row public.automation_live_crm_cursors%ROWTYPE;
 v record; scanned integer:=0;v_id uuid;
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
 THEN RAISE EXCEPTION 'LIVE_CRM_POLL_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO cursor_row FROM public.automation_live_crm_cursors
 WHERE workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_CRM_CURSOR_NOT_INITIALIZED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
 JOIN public.automation_channel_ownership o ON o.workspace_id=w.id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active AND s.mode='live'
 AND NOT s.emergency_stop AND o.channel='crm' AND o.owner='new_engine'
 AND o.legacy_dispatch_paused_at IS NOT NULL AND o.release_approved_at IS NOT NULL)
 THEN RAISE EXCEPTION 'LIVE_CRM_POLL_RUNTIME_BLOCKED' USING ERRCODE='42501'; END IF;
 FOR v IN SELECT e.id,e.created_at FROM public.crm_events e
  WHERE e.event_type IN ('received','stage_changed') AND e.deal_id IS NOT NULL
    AND (e.created_at,e.id)>(cursor_row.last_at,cursor_row.last_id)
  ORDER BY e.created_at,e.id LIMIT p_limit
 LOOP
  -- Inside a single transaction with cursor lock; invalid events are
  -- intentionally not skipped. They require an explicit operator decision.
  v_id:=public.automation_live_crm_ingest(p_workspace_id,v.id);
  cursor_row.last_at:=v.created_at;cursor_row.last_id:=v.id;scanned:=scanned+1;
 END LOOP;
 UPDATE public.automation_live_crm_cursors
 SET last_at=cursor_row.last_at,last_id=cursor_row.last_id
 WHERE workspace_id=p_workspace_id;
 RETURN jsonb_build_object('scanned',scanned,'source','crm',
  'dispatchAuthorized',false,'providerCalls',0);
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_live_crm_fail(
 p_workspace_id uuid,p_inbox_id uuid,p_lease_token uuid,p_code text
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE i public.automation_event_inbox%ROWTYPE;
BEGIN
 IF p_workspace_id IS NULL OR p_inbox_id IS NULL OR p_lease_token IS NULL
   OR p_code NOT IN ('LIVE_CONTEXT_UNAVAILABLE','LIVE_GRAPH_REJECTED',
     'LIVE_COMMIT_UNAVAILABLE','LIVE_VERSION_DRIFT')
 THEN RAISE EXCEPTION 'LIVE_FAILURE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO i FROM public.automation_event_inbox
 WHERE workspace_id=p_workspace_id AND id=p_inbox_id FOR UPDATE;
 IF NOT FOUND OR i.state<>'pending' OR i.lease_token IS DISTINCT FROM p_lease_token
 THEN RAISE EXCEPTION 'LIVE_FAILURE_LEASE_STALE' USING ERRCODE='42501'; END IF;
 IF i.attempts>=5 THEN
  UPDATE public.automation_event_inbox SET state='failed',last_error_code='LIVE_QUARANTINED',
   lease_token=NULL,lease_until=NULL,processed_at=clock_timestamp()
  WHERE id=i.id;
  RETURN 'quarantined';
 END IF;
 UPDATE public.automation_event_inbox SET
  last_error_code=p_code,lease_token=NULL,
  lease_until=clock_timestamp()+(interval '30 seconds' * (i.attempts*i.attempts))
 WHERE id=i.id;
 RETURN 'retry_scheduled';
END $fn$;
REVOKE ALL ON FUNCTION public.automation_live_crm_init_cursor(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_live_crm_poll(uuid,integer)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_live_crm_fail(uuid,uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_live_crm_init_cursor(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_live_crm_poll(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_live_crm_fail(uuid,uuid,uuid,text) TO service_role;