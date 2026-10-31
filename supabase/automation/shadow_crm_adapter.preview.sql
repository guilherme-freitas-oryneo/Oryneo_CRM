-- REVIEW ONLY. Disposable PostgreSQL QA; no cron, trigger or live dispatcher.
-- Converts canonical CRM journal entries into non-emitting automation events.
-- Cursor MUST be initialized deliberately while runtime is disabled;
-- never silently replay historic records or skip a gap on first worker call.
BEGIN;
CREATE TABLE IF NOT EXISTS public.automation_ingest_cursors(
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 source text NOT NULL CHECK(source IN ('crm')),
 last_occurred_at timestamptz NOT NULL,
 last_event_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
 initialized_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,source)
);
ALTER TABLE public.automation_ingest_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_ingest_cursors FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.automation_ingest_cursors TO service_role;

CREATE OR REPLACE FUNCTION public.automation_shadow_init_crm_cursor(
 p_workspace_id uuid,p_actor_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_time timestamptz;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.automation_workspace_members m
      JOIN public.crm_members crm ON crm.user_id=m.user_id
      JOIN public.automation_runtime_settings s ON s.workspace_id=m.workspace_id
      JOIN public.automation_workspaces w ON w.id=m.workspace_id
    WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id AND m.role='admin'
      AND s.mode='disabled' AND s.emergency_stop AND NOT w.active
  ) THEN RAISE EXCEPTION 'SHADOW_BOOTSTRAP_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
  -- Initialized once: concurrent or repeated admin calls can NEVER rewind cursor.
  INSERT INTO public.automation_ingest_cursors
    (workspace_id,source,last_occurred_at,initialized_by)
    VALUES(p_workspace_id,'crm',clock_timestamp(),p_actor_id)
    ON CONFLICT(workspace_id,source) DO NOTHING;
  SELECT last_occurred_at INTO v_time
    FROM public.automation_ingest_cursors
    WHERE workspace_id=p_workspace_id AND source='crm';
  RETURN v_time;
END; $$;

CREATE OR REPLACE FUNCTION public.automation_shadow_ingest_crm(
 p_workspace_id uuid,p_batch_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE
  v_cursor public.automation_ingest_cursors%ROWTYPE;
  v_event RECORD;
  v_seen integer :=0;
  v_added integer :=0;
  v_inserted uuid;
  v_type text;
BEGIN
  IF p_batch_limit IS NULL OR p_batch_limit NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'SHADOW_CRM_BATCH_INVALID' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
    WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop
  ) THEN RAISE EXCEPTION 'SHADOW_RUNTIME_DISABLED' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_cursor FROM public.automation_ingest_cursors
    WHERE workspace_id=p_workspace_id AND source='crm' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHADOW_CURSOR_UNINITIALIZED' USING ERRCODE='42501'; END IF;
  FOR v_event IN
    SELECT e.id,e.deal_id,e.event_type,e.created_at
    FROM public.crm_events e
    WHERE (e.created_at,e.id)>(v_cursor.last_occurred_at,v_cursor.last_event_id)
      AND e.event_type IN ('received','stage_changed') AND e.deal_id IS NOT NULL
    ORDER BY e.created_at,e.id LIMIT p_batch_limit
  LOOP
    -- This mapping is sourced exclusively from the canonical CRM event journal.
    v_type:=CASE v_event.event_type
      WHEN 'received' THEN 'opportunity.created'
      WHEN 'stage_changed' THEN 'opportunity.stage_changed' END;
    v_inserted:=NULL;
    INSERT INTO public.automation_event_inbox
      (workspace_id,source,event_id,event_type,schema_version,context_refs)
      VALUES(p_workspace_id,'crm','crm:'||v_event.id::text,v_type,'1.0.0',
        jsonb_build_object('opportunity_id',v_event.deal_id::text))
      ON CONFLICT(workspace_id,source,event_id) DO NOTHING RETURNING id INTO v_inserted;
    IF v_inserted IS NOT NULL THEN v_added:=v_added+1; END IF;
    v_cursor.last_occurred_at:=v_event.created_at;
    v_cursor.last_event_id:=v_event.id;
    v_seen:=v_seen+1;
  END LOOP;
  IF v_seen>0 THEN
    UPDATE public.automation_ingest_cursors SET
      last_occurred_at=v_cursor.last_occurred_at,
      last_event_id=v_cursor.last_event_id,
      updated_at=now()
      WHERE workspace_id=p_workspace_id AND source='crm';
  END IF;
  RETURN jsonb_build_object('shadowOnly',true,'dispatchAuthorized',false,
    'scanned',v_seen,'inserted',v_added,'hasMorePossible',v_seen=p_batch_limit);
END; $$;

REVOKE ALL ON FUNCTION public.automation_shadow_init_crm_cursor(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_shadow_ingest_crm(uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_shadow_init_crm_cursor(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_shadow_ingest_crm(uuid,integer) TO service_role;
COMMIT;
