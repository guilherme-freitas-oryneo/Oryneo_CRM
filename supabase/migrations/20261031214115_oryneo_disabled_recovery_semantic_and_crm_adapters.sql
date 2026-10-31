-- Applied via Supabase migration 20261031214115 with runtime disabled; no live actions.
-- Historical source for reproducible deployment. Avoid reapplying to hosted production.
BEGIN;
-- Source: supabase/automation/shadow_resume.preview.sql (blob af436380113618712fdebaaea245d660b64c28a5)
-- ORYNEO isolated shadow continuation. QA PREVIEW ONLY, no production migration.
-- A due timer can advance ONLY in shadow mode, from an immutable version,
-- with a graph-bound trace. Every planned action is persisted as BLOCKED.

ALTER TABLE public.automation_wait_timers
 ADD COLUMN IF NOT EXISTS resumed_at timestamptz,
 ADD COLUMN IF NOT EXISTS resume_attempts integer NOT NULL DEFAULT 0
   CHECK (resume_attempts BETWEEN 0 AND 5),
 ADD COLUMN IF NOT EXISTS resume_next_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN IF NOT EXISTS resume_error_code text;
CREATE INDEX IF NOT EXISTS automation_wait_resume_due_idx
 ON public.automation_wait_timers(workspace_id,resume_next_at,id)
 WHERE state='due' AND resumed_at IS NULL;

CREATE OR REPLACE FUNCTION public.automation_wait_shadow_resume(
 p_workspace_id uuid,p_wait_id uuid,p_decision jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 t public.automation_wait_timers%ROWTYPE;
 v_execution public.automation_executions%ROWTYPE;
 v_graph jsonb; v_node jsonb; v_previous text; v_first text;
 v_expected text; v_step jsonb; v_action jsonb;
 v_action_node text; v_action_type text; v_count integer:=0;
 v_state text; v_index integer:=0;
BEGIN
 IF p_workspace_id IS NULL OR p_wait_id IS NULL OR p_decision IS NULL
  OR jsonb_typeof(p_decision)<>'object'
  OR octet_length(p_decision::text)>131072
  OR p_decision->>'shadowOnly'<>'true'
  OR p_decision->>'dispatchAuthorized'<>'false'
  OR p_decision->>'state' NOT IN ('completed','blocked','waiting','awaiting_server_outcome')
  OR jsonb_typeof(p_decision->'trace')<>'array'
  OR jsonb_array_length(p_decision->'trace') NOT BETWEEN 1 AND 500
  OR jsonb_typeof(p_decision->'plannedActions')<>'array'
  OR jsonb_array_length(p_decision->'plannedActions')>50
 THEN RAISE EXCEPTION 'SHADOW_CONTINUATION_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
  WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop)
 THEN RAISE EXCEPTION 'SHADOW_CONTINUATION_STOPPED' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM public.automation_wait_timers
  WHERE workspace_id=p_workspace_id AND id=p_wait_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SHADOW_WAIT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF t.resumed_at IS NOT NULL THEN
  RETURN jsonb_build_object('alreadyResumed',true,'dispatchAuthorized',false);
 END IF;
 IF t.state<>'due' OR t.resume_attempts>=5 OR t.resume_next_at>clock_timestamp()
 THEN RAISE EXCEPTION 'SHADOW_WAIT_NOT_CLAIMABLE' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_execution FROM public.automation_executions
  WHERE workspace_id=p_workspace_id AND id=t.execution_id FOR UPDATE;
 IF NOT FOUND OR v_execution.state<>'shadow'
 THEN RAISE EXCEPTION 'SHADOW_EXECUTION_NOT_ACTIVE' USING ERRCODE='42501'; END IF;
 SELECT graph_json INTO v_graph FROM public.automation_flow_versions
  WHERE workspace_id=p_workspace_id AND id=v_execution.flow_version_id
    AND status='published';
 IF v_graph IS NULL OR jsonb_typeof(v_graph->'nodes')<>'array'
 THEN RAISE EXCEPTION 'SHADOW_FROZEN_GRAPH_REQUIRED' USING ERRCODE='22023'; END IF;
 SELECT n.value INTO v_node FROM jsonb_array_elements(v_graph->'nodes') AS n(value)
  WHERE n.value->>'id'=t.node_id AND n.value->>'type'='wait' LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'SHADOW_WAIT_NODE_NOT_IN_GRAPH' USING ERRCODE='22023'; END IF;
 SELECT e.value->>'target' INTO v_expected FROM jsonb_array_elements(v_graph->'edges') AS e(value)
  WHERE e.value->>'source'=t.node_id AND e.value->>'source_port'='out' LIMIT 1;
 IF v_expected IS NULL THEN RAISE EXCEPTION 'SHADOW_WAIT_OUT_EDGE_MISSING' USING ERRCODE='22023'; END IF;
 FOR v_step IN SELECT value FROM jsonb_array_elements(p_decision->'trace') AS a(value) LOOP
   v_first:=v_step->>'nodeId';
   IF v_first IS NULL OR v_first<>v_expected
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_graph->'nodes') AS n(value)
       WHERE n.value->>'id'=v_first AND n.value->>'type'=v_step->>'type')
     OR v_step->>'status' NOT IN ('evaluated','completed','waiting','requires_server_result')
   THEN RAISE EXCEPTION 'SHADOW_CONTINUATION_TRACE_INVALID' USING ERRCODE='22023'; END IF;
   IF v_index>0 AND NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(v_graph->'edges') AS e(value)
     WHERE e.value->>'source'=v_previous AND e.value->>'target'=v_first
   ) THEN RAISE EXCEPTION 'SHADOW_CONTINUATION_EDGE_INVALID' USING ERRCODE='22023'; END IF;
   INSERT INTO public.automation_node_executions
     (workspace_id,execution_id,node_id,state,result_code,sanitized_trace)
   VALUES(p_workspace_id,t.execution_id,v_first,
     CASE WHEN v_step->>'status'='waiting' THEN 'waiting' ELSE 'planned' END,
     LEFT(v_step->>'status',48),
     jsonb_build_object('type',LEFT(v_step->>'type',48),'from_wait',t.node_id))
   ON CONFLICT (execution_id,node_id,attempt) DO NOTHING;
   v_previous:=v_first;
   v_expected:=NULL; -- updated below from actual graph edge, if any
   IF v_step ? 'nextPort' THEN
     SELECT e.value->>'target' INTO v_expected
     FROM jsonb_array_elements(v_graph->'edges') AS e(value)
     WHERE e.value->>'source'=v_first
       AND e.value->>'source_port'=v_step->>'nextPort' LIMIT 1;
   END IF;
   v_index:=v_index+1;
 END LOOP;
 -- Verify the last traced status actually reflects the decision state.
 v_step:=p_decision->'trace'->(v_index-1);
 v_state:=p_decision->>'state';
 IF (v_state='completed' AND v_step->>'status'<>'completed')
  OR (v_state='waiting' AND v_step->>'status'<>'waiting')
  OR (v_state='awaiting_server_outcome' AND v_step->>'status'<>'requires_server_result')
 THEN RAISE EXCEPTION 'SHADOW_CONTINUATION_TERMINAL_INVALID' USING ERRCODE='22023'; END IF;
 FOR v_action IN SELECT value FROM jsonb_array_elements(p_decision->'plannedActions') AS a(value) LOOP
  v_action_node:=v_action->>'nodeId';v_action_type:=v_action->>'type';
  IF (v_action->>'actionKey') !~ '^[0-9a-f]{64}$'
   OR v_action_type NOT IN ('whatsapp_template','whatsapp_reply','email',
     'crm_stage_change','crm_task','crm_update','human_handoff','notify')
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_graph->'nodes') AS n(value)
      WHERE n.value->>'id'=v_action_node AND n.value->>'type'=v_action_type)
  THEN RAISE EXCEPTION 'SHADOW_CONTINUATION_ACTION_INVALID' USING ERRCODE='22023'; END IF;
  INSERT INTO public.automation_action_outbox
   (workspace_id,execution_id,node_id,action_key,action_type,state)
  VALUES(p_workspace_id,t.execution_id,v_action_node,
   v_action->>'actionKey',v_action_type,'blocked')
  ON CONFLICT(workspace_id,action_key) DO NOTHING;
  v_count:=v_count+1;
 END LOOP;
 UPDATE public.automation_wait_timers
 SET resumed_at=clock_timestamp(),
  reason_code=CASE WHEN v_state='blocked' THEN 'SHADOW_RESUME_BLOCKED'
       ELSE 'SHADOW_RESUMED' END,
  updated_at=clock_timestamp()
 WHERE workspace_id=p_workspace_id AND id=p_wait_id;
 RETURN jsonb_build_object('resumed',true,'traceCount',v_index,
  'blockedActionCount',v_count,'dispatchAuthorized',false);
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_wait_shadow_resume_fail(
 p_workspace_id uuid,p_wait_id uuid,p_code text
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE t public.automation_wait_timers%ROWTYPE;
BEGIN
 IF p_workspace_id IS NULL OR p_wait_id IS NULL
 OR p_code NOT IN ('SHADOW_RESUME_UNAVAILABLE','SHADOW_RESUME_CONTEXT',
   'SHADOW_RESUME_PLAN','SHADOW_RESUME_ACK')
 THEN RAISE EXCEPTION 'SHADOW_RESUME_FAILURE_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM public.automation_wait_timers WHERE workspace_id=p_workspace_id
  AND id=p_wait_id FOR UPDATE;
 IF NOT FOUND OR t.state<>'due' OR t.resumed_at IS NOT NULL
 THEN RAISE EXCEPTION 'SHADOW_RESUME_FAILURE_STALE' USING ERRCODE='42501'; END IF;
 IF t.resume_attempts>=4 THEN
   UPDATE public.automation_wait_timers SET resume_attempts=5,
     state='cancelled',reason_code='SHADOW_CONTINUATION_DEAD_LETTER',
     resume_error_code=p_code,updated_at=clock_timestamp()
   WHERE id=t.id;
   RETURN 'quarantined';
 END IF;
 UPDATE public.automation_wait_timers SET
  resume_attempts=resume_attempts+1,
  resume_error_code=p_code,
  resume_next_at=clock_timestamp()+(CASE t.resume_attempts
   WHEN 0 THEN interval '30 seconds'
   WHEN 1 THEN interval '2 minutes'
   WHEN 2 THEN interval '5 minutes'
   ELSE interval '15 minutes' END),
  updated_at=clock_timestamp()
 WHERE id=t.id;
 RETURN 'retry_scheduled';
END $fn$;
REVOKE ALL ON FUNCTION public.automation_wait_shadow_resume(uuid,uuid,jsonb)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_wait_shadow_resume_fail(uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_resume(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_resume_fail(uuid,uuid,text) TO service_role;


-- Source: supabase/automation/shadow_due_policy.preview.sql (blob 93a5963cbdd3972b2bb9c52708d510d16c66e22e)
-- ORYNEO: extra safety boundary for due shadow timers.
-- Disposable PostgreSQL QA preview; NO live sends or CRM mutations.
-- A due timer is never assumed safe just because it passed the earlier poll.

CREATE OR REPLACE FUNCTION public.automation_wait_shadow_due_policy(
 p_workspace_id uuid, p_wait_id uuid
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 t public.automation_wait_timers%ROWTYPE;
 c record;
 v_reason text;
BEGIN
 IF p_workspace_id IS NULL OR p_wait_id IS NULL
 THEN RAISE EXCEPTION 'DUE_POLICY_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM public.automation_wait_timers
 WHERE workspace_id=p_workspace_id AND id=p_wait_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DUE_POLICY_WAIT_MISSING' USING ERRCODE='P0002'; END IF;
 IF t.state<>'due' OR t.resumed_at IS NOT NULL
 THEN RETURN 'not_due'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
  WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop)
 THEN RETURN 'runtime_stopped'; END IF;
 IF t.conversation_id IS NULL THEN RETURN 'ready'; END IF;
 -- Lock conversation state during this SQL transaction. A second, DB-enforced
 -- resume trigger repeats the check just before acknowledging the trace.
 SELECT mode,opted_out,consent_granted INTO c FROM public.crm_wa_conversations
  WHERE id=t.conversation_id FOR SHARE;
 IF NOT FOUND THEN v_reason:='CONVERSATION_NOT_FOUND';
 ELSIF c.opted_out IS TRUE THEN v_reason:='OPTED_OUT';
 ELSIF c.consent_granted IS DISTINCT FROM TRUE THEN v_reason:='CONSENT_NOT_VERIFIED';
 ELSIF c.mode IS DISTINCT FROM 'sdr_active' THEN v_reason:='HUMAN_OR_REVIEW_MODE';
 ELSIF t.cancel_on_reply AND EXISTS(
   SELECT 1 FROM public.crm_wa_messages m
   WHERE m.conversation_id=t.conversation_id
     AND m.direction='inbound'
     AND m.reaction_to_provider_message_id IS NULL
     AND m.occurred_at>=t.created_at
 ) THEN v_reason:='CANONICAL_INBOUND_RECEIVED';
 END IF;
 IF v_reason IS NOT NULL THEN
  UPDATE public.automation_wait_timers SET
    state='cancelled',reason_code=v_reason,updated_at=clock_timestamp()
  WHERE id=t.id AND workspace_id=p_workspace_id;
  RETURN 'cancelled';
 END IF;
 RETURN 'ready';
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_wait_shadow_resume_atomic_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 c record;
BEGIN
 IF OLD.resumed_at IS NOT NULL OR NEW.resumed_at IS NULL
 THEN RETURN NEW; END IF;
 IF NEW.state<>'due' OR OLD.state<>'due'
  OR NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
     JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
     WHERE w.id=NEW.workspace_id AND w.active AND s.mode='shadow'
       AND NOT s.emergency_stop)
 THEN RAISE EXCEPTION 'SHADOW_RESUME_RUNTIME_GUARD_DENIED' USING ERRCODE='42501'; END IF;
 IF OLD.conversation_id IS NOT NULL THEN
  SELECT mode,opted_out,consent_granted INTO c FROM public.crm_wa_conversations
  WHERE id=OLD.conversation_id FOR SHARE;
  IF NOT FOUND OR c.mode IS DISTINCT FROM 'sdr_active'
    OR c.opted_out IS TRUE OR c.consent_granted IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'SHADOW_RESUME_CONVERSATION_GUARD_DENIED'
    USING ERRCODE='42501'; END IF;
  IF OLD.cancel_on_reply AND EXISTS(
   SELECT 1 FROM public.crm_wa_messages m
    WHERE m.conversation_id=OLD.conversation_id AND m.direction='inbound'
     AND m.reaction_to_provider_message_id IS NULL
     AND m.occurred_at>=OLD.created_at
  ) THEN RAISE EXCEPTION 'SHADOW_RESUME_CANONICAL_REPLY_PRESENT'
    USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS automation_wait_resume_atomic_guard
 ON public.automation_wait_timers;
CREATE TRIGGER automation_wait_resume_atomic_guard
 BEFORE UPDATE OF resumed_at ON public.automation_wait_timers
 FOR EACH ROW WHEN (OLD.resumed_at IS NULL AND NEW.resumed_at IS NOT NULL)
 EXECUTE FUNCTION public.automation_wait_shadow_resume_atomic_guard();

REVOKE ALL ON FUNCTION public.automation_wait_shadow_due_policy(uuid,uuid)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_wait_shadow_resume_atomic_guard()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_due_policy(uuid,uuid)
 TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_wait_shadow_resume_atomic_guard()
 TO service_role;


-- Source: supabase/automation/rollback_disabled.preview.sql (blob a857599e903209eae4df6c837db786dd136d3991)
-- ORYNEO disabled-mode immutable rollback. Disposable QA preview ONLY.
-- Never edits a published snapshot, runs a flow or emits an action.

CREATE OR REPLACE FUNCTION public.automation_rollback_disabled(
 p_workspace_id uuid,p_actor_id uuid,p_flow_id uuid,
 p_target_version_id uuid,p_expected_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE f public.automation_flows%ROWTYPE; v public.automation_flow_versions%ROWTYPE;
 next_revision bigint;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_flow_id IS NULL
 OR p_target_version_id IS NULL OR p_expected_revision IS NULL
 OR p_expected_revision<1
 THEN RAISE EXCEPTION 'ROLLBACK_REQUEST_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_members c
  JOIN public.automation_workspace_members m ON m.user_id=c.user_id
  WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id
    AND m.role IN ('admin','publisher'))
 THEN RAISE EXCEPTION 'ROLLBACK_PUBLISHER_REQUIRED' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_runtime_settings s
  WHERE s.workspace_id=p_workspace_id AND s.mode='disabled'
   AND s.emergency_stop)
 THEN RAISE EXCEPTION 'ROLLBACK_RUNTIME_NOT_STOPPED' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.automation_flows
  WHERE workspace_id=p_workspace_id AND id=p_flow_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ROLLBACK_FLOW_MISSING' USING ERRCODE='P0002'; END IF;
 IF f.revision<>p_expected_revision THEN
  RAISE EXCEPTION 'ROLLBACK_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 SELECT * INTO v FROM public.automation_flow_versions
 WHERE workspace_id=p_workspace_id AND flow_id=p_flow_id
   AND id=p_target_version_id AND status='published'
   AND content_sha256 ~ '^[0-9a-f]{64}$';
 IF NOT FOUND THEN RAISE EXCEPTION 'ROLLBACK_TARGET_INVALID' USING ERRCODE='22023'; END IF;
 UPDATE public.automation_flows SET
  published_version_id=v.id,enabled=false,
  revision=revision+1,updated_by=p_actor_id,updated_at=clock_timestamp()
 WHERE workspace_id=p_workspace_id AND id=p_flow_id
 RETURNING revision INTO next_revision;
 INSERT INTO public.automation_audit_log
 (workspace_id,actor_id,action,target_type,target_id,summary)
 VALUES(p_workspace_id,p_actor_id,'flow_rolled_back_disabled','flow',p_flow_id,
  jsonb_build_object('fromVersionId',f.published_version_id,
   'toVersionId',v.id,'sha256',v.content_sha256,'revision',next_revision,
   'runtimeEnabled',false));
 RETURN jsonb_build_object('flowId',p_flow_id,'fromVersionId',f.published_version_id,
   'toVersionId',v.id,'revision',next_revision,'enabled',false,
   'dispatchAuthorized',false);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_rollback_disabled(uuid,uuid,uuid,uuid,bigint)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_rollback_disabled(uuid,uuid,uuid,uuid,bigint)
 TO service_role;


-- Source: supabase/automation/sdr_semantic_release.preview.sql (blob 485649d719631db8dc4acdd56cf05dcdbd516d5b)
-- ORYNEO Stage 4 — reviewable knowledge + semantic release pairing.
-- PREVIEW ONLY: isolated PostgreSQL 17 QA, NEVER hosted by this PR.
-- The existing SDR continues unchanged. No AI prompt, WA, Stripe or email
-- is modified; the release pointer remains DISABLED after every publication.

CREATE TABLE IF NOT EXISTS public.automation_sdr_active_release(
 workspace_id uuid PRIMARY KEY REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 knowledge_release_id uuid REFERENCES public.automation_knowledge_release(id) ON DELETE RESTRICT,
 dictionary_release_id uuid REFERENCES public.automation_intent_dictionary(id) ON DELETE RESTRICT,
 enabled boolean NOT NULL DEFAULT false CHECK(enabled=false),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),
 changed_by uuid,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT sdr_release_pair_atomic CHECK(
   (knowledge_release_id IS NULL AND dictionary_release_id IS NULL)
   OR (knowledge_release_id IS NOT NULL AND dictionary_release_id IS NOT NULL))
);
ALTER TABLE public.automation_sdr_active_release ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automation_sdr_active_release FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_sdr_active_release TO service_role;
GRANT UPDATE(knowledge_release_id,dictionary_release_id,revision,changed_by,changed_at)
 ON public.automation_sdr_active_release TO service_role;
-- Runtime opt-in requires a future, separately authorized release procedure.
-- No UPDATE grant is given to service_role in this stage.
INSERT INTO public.automation_sdr_active_release(workspace_id)
 SELECT id FROM public.automation_workspaces WHERE slug='oryneo-crm'
 ON CONFLICT (workspace_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.automation_sdr_protect_published()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $guard$
BEGIN
 IF OLD.status='published'
 THEN RAISE EXCEPTION 'SDR_PUBLISHED_RELEASE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $guard$;
REVOKE ALL ON FUNCTION public.automation_sdr_protect_published() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS automation_sdr_knowledge_immutable ON public.automation_knowledge_release;
CREATE TRIGGER automation_sdr_knowledge_immutable BEFORE UPDATE OR DELETE
 ON public.automation_knowledge_release FOR EACH ROW
 EXECUTE FUNCTION public.automation_sdr_protect_published();
DROP TRIGGER IF EXISTS automation_sdr_intent_immutable ON public.automation_intent_dictionary;
CREATE TRIGGER automation_sdr_intent_immutable BEFORE UPDATE OR DELETE
 ON public.automation_intent_dictionary FOR EACH ROW
 EXECUTE FUNCTION public.automation_sdr_protect_published();

-- Publish must be a deliberate transaction performed only while runtime is
-- disabled and stopped. It never switches the SDR's active release.
CREATE OR REPLACE FUNCTION public.automation_sdr_publish_pair_disabled(
 p_workspace_id uuid,p_actor_id uuid,p_knowledge_id uuid,p_dictionary_id uuid,
 p_expected_revision bigint,p_dictionary_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE
 k public.automation_knowledge_release%ROWTYPE;
 d public.automation_intent_dictionary%ROWTYPE;
 s public.automation_sdr_active_release%ROWTYPE;
 v jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_actor_id IS NULL OR p_knowledge_id IS NULL
 OR p_dictionary_id IS NULL OR p_expected_revision IS NULL OR p_dictionary_hash
 !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'SDR_RELEASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings r ON r.workspace_id=w.id
 JOIN public.automation_workspace_members m ON m.workspace_id=w.id
 JOIN public.crm_members cm ON cm.user_id=m.user_id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND NOT w.active
 AND r.mode='disabled' AND r.emergency_stop
 AND m.user_id=p_actor_id AND m.role IN ('admin','publisher')
 FOR SHARE OF w,r,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_RELEASE_AUTH_DENIED' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.automation_sdr_active_release
 WHERE workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR s.revision<>p_expected_revision OR s.enabled
 THEN RAISE EXCEPTION 'SDR_RELEASE_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 SELECT * INTO k FROM public.automation_knowledge_release
 WHERE id=p_knowledge_id AND workspace_id=p_workspace_id FOR UPDATE;
 SELECT * INTO d FROM public.automation_intent_dictionary
 WHERE id=p_dictionary_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF k.id IS NULL OR d.id IS NULL OR k.status<>'draft' OR d.status<>'draft'
 OR k.approved_by IS NOT NULL OR d.approved_by IS NOT NULL
 OR k.content_sha256<>'74c48113909964a8fab5e221a2d05b3ee2d999ecb5d907ddbb1baafec3c9c61c'
 OR k.source_refs #>> '{playbook,blob_sha}'<>'85dc97cc5ca0c208982940bd6573b7cd50afd133'
 OR k.source_refs #>> '{pricing_catalog,blob_sha}'<>'c157c4425c420d82fa9a3865d65972f4d22b60e0'
 OR k.source_refs #>> '{legal_terms,usage}'<>'blocked'
 THEN RAISE EXCEPTION 'SDR_KNOWLEDGE_UNVERIFIED' USING ERRCODE='42501'; END IF;
 -- Explicit schema checks: the runtime separately verifies the SHA-256
 -- of stable-canonical JSON before each use (no serialization ambiguity).
 IF d.language<>'pt_BR' OR d.content_sha256 IS DISTINCT FROM p_dictionary_hash
 OR jsonb_typeof(d.examples)<>'array'
 OR jsonb_array_length(d.examples) NOT BETWEEN 10 AND 40
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(d.examples) e
  WHERE jsonb_typeof(e)<>'object'
   OR e->>'id' !~ '^[a-z][a-z0-9_]{1,40}$'
   OR jsonb_typeof(e->'positive')<>'array'
   OR jsonb_typeof(e->'negative')<>'array'
   OR jsonb_typeof(e->'synonyms')<>'array'
   OR e->>'risk' NOT IN ('normal','human_review'))
 THEN RAISE EXCEPTION 'SDR_DICTIONARY_UNVERIFIED' USING ERRCODE='42501'; END IF;
 UPDATE public.automation_knowledge_release SET status='published',approved_by=p_actor_id
 WHERE id=k.id AND status='draft';
 UPDATE public.automation_intent_dictionary SET status='published',approved_by=p_actor_id
 WHERE id=d.id AND status='draft';
 UPDATE public.automation_sdr_active_release SET
  knowledge_release_id=k.id,dictionary_release_id=d.id,
  revision=revision+1,changed_by=p_actor_id,changed_at=clock_timestamp()
  WHERE workspace_id=p_workspace_id AND revision=p_expected_revision;
 INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
 VALUES(p_workspace_id,p_actor_id,'sdr_pair_published_disabled','knowledge_release',k.id,
   jsonb_build_object('dictionary_version',d.release_version,
    'knowledge_version',k.release_version,'dispatch_authorized',false,
    'enabled',false));
 RETURN jsonb_build_object('ok',true,'publishedDisabled',true,
  'revision',s.revision+1,'dispatchAuthorized',false);
END $fn$;

-- A rollback changes only the selected pair, never mutates an approved release,
-- never implicitly activates either release, and retains CAS under stop.
CREATE OR REPLACE FUNCTION public.automation_sdr_select_pair_disabled(
 p_workspace_id uuid,p_actor_id uuid,p_knowledge_id uuid,p_dictionary_id uuid,
 p_expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE s public.automation_sdr_active_release%ROWTYPE;
BEGIN
 PERFORM 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings r ON r.workspace_id=w.id
 JOIN public.automation_workspace_members m ON m.workspace_id=w.id
 JOIN public.crm_members cm ON cm.user_id=m.user_id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND NOT w.active
 AND r.mode='disabled' AND r.emergency_stop
 AND m.user_id=p_actor_id AND m.role IN ('admin','publisher')
 FOR SHARE OF w,r,m;
 IF NOT FOUND THEN RAISE EXCEPTION 'SDR_ROLLBACK_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM public.automation_sdr_active_release
 WHERE workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR s.revision<>p_expected_revision OR s.enabled
 THEN RAISE EXCEPTION 'SDR_ROLLBACK_CAS_CONFLICT' USING ERRCODE='40001'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_knowledge_release k
   WHERE k.id=p_knowledge_id AND k.workspace_id=p_workspace_id
    AND k.status='published' AND k.approved_by IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM public.automation_intent_dictionary d
   WHERE d.id=p_dictionary_id AND d.workspace_id=p_workspace_id
    AND d.status='published' AND d.approved_by IS NOT NULL)
 THEN RAISE EXCEPTION 'SDR_ROLLBACK_TARGET_INVALID' USING ERRCODE='42501'; END IF;
 UPDATE public.automation_sdr_active_release SET
  knowledge_release_id=p_knowledge_id,dictionary_release_id=p_dictionary_id,
  revision=revision+1,changed_by=p_actor_id,changed_at=clock_timestamp()
 WHERE workspace_id=p_workspace_id AND revision=p_expected_revision;
 INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
 VALUES(p_workspace_id,p_actor_id,'sdr_pair_selected_disabled',
  'knowledge_release',p_knowledge_id,jsonb_build_object(
    'dictionary_release_id',p_dictionary_id,'dispatch_authorized',false));
 RETURN jsonb_build_object('ok',true,'revision',s.revision+1,'dispatchAuthorized',false);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_sdr_publish_pair_disabled(uuid,uuid,uuid,uuid,bigint,text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_sdr_select_pair_disabled(uuid,uuid,uuid,uuid,bigint)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_sdr_publish_pair_disabled(uuid,uuid,uuid,uuid,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_sdr_select_pair_disabled(uuid,uuid,uuid,uuid,bigint) TO service_role;


-- Source: supabase/automation/commercial_crm_claim.preview.sql (blob 995b230dec694253d59b775aa994e0011cd171c7)
-- Macro 3: claim exclusively CRM-owned effects. PREVIEW, never deployed.
-- Does NOT claim Meta/email/Stripe actions or call external transports.

CREATE OR REPLACE FUNCTION public.automation_commercial_claim_crm(
 p_workspace_id uuid,p_limit integer DEFAULT 3
) RETURNS TABLE(
 action_id uuid,claim_token uuid,action_key text,action_type text,
 expected_deal_revision bigint
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5
 THEN RAISE EXCEPTION 'COMMERCIAL_CLAIM_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
  JOIN public.automation_channel_ownership own ON own.workspace_id=w.id
  WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active
    AND s.mode='live' AND s.emergency_stop IS FALSE
    AND own.channel='crm' AND own.owner='new_engine'
    AND own.legacy_dispatch_paused_at IS NOT NULL
    AND own.release_approved_at IS NOT NULL)
 THEN RETURN; END IF;
 RETURN QUERY
 WITH candidate AS(
   SELECT a.id,d.revision AS expected_revision
   FROM public.automation_action_outbox a
   JOIN public.automation_executions e ON e.id=a.execution_id
     AND e.workspace_id=a.workspace_id AND e.state='running'
   JOIN public.automation_event_inbox i ON i.id=e.inbox_id
     AND i.workspace_id=a.workspace_id
   JOIN public.automation_flow_versions v ON v.id=e.flow_version_id
     AND v.workspace_id=a.workspace_id AND v.status='published'
   JOIN public.automation_flows f ON f.id=v.flow_id
     AND f.workspace_id=v.workspace_id AND f.enabled
     AND f.published_version_id=v.id
   JOIN public.crm_records d ON d.id=CASE WHEN
     i.context_refs->>'opportunity_id' ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     THEN (i.context_refs->>'opportunity_id')::uuid ELSE NULL END
     AND d.kind='deal' AND NOT d.deleted
   WHERE a.workspace_id=p_workspace_id AND a.state='queued'
     AND a.action_type IN ('crm_stage_change','crm_task')
     AND (a.due_at IS NULL OR a.due_at<=clock_timestamp())
     AND a.attempts<3
     AND jsonb_typeof(v.graph_json->'nodes')='array'
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n
       WHERE n->>'id'=a.node_id AND n->>'type'=a.action_type)
   ORDER BY a.due_at NULLS FIRST,a.created_at,a.id LIMIT p_limit
   FOR UPDATE OF a SKIP LOCKED
 ), leased AS(
   UPDATE public.automation_action_outbox a
   SET state='leased',claim_token=gen_random_uuid(),
     attempts=a.attempts+1,claimed_at=clock_timestamp(),
     lease_until=clock_timestamp()+interval '90 seconds'
   FROM candidate c WHERE a.id=c.id
   RETURNING a.id,a.claim_token,a.action_key,a.action_type
 )
 SELECT l.id,l.claim_token,l.action_key,l.action_type,c.expected_revision
 FROM leased l JOIN candidate c ON c.id=l.id;
END $fn$;
REVOKE ALL ON FUNCTION public.automation_commercial_claim_crm(uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_commercial_claim_crm(uuid,integer)
 TO service_role;


-- Source: supabase/automation/commercial_crm_stage_adapter.preview.sql (blob 355879cd637cff5763f65fccb6d6c56aeac7e769)
-- ORYNEO Macro 3: PREVIEW ONLY, no release or hosted application.
-- Atomic, version-fenced CRM stage adapter. The effective target stage is
-- read from the immutable published graph, NOT worker/browser input.
-- The existing CRM stage IDs and history are retained. No Stripe/Meta/email.

CREATE OR REPLACE FUNCTION public.automation_crm_stage_action(
 p_workspace_id uuid,p_action_id uuid,p_claim_token uuid,p_expected_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 a public.automation_action_outbox%ROWTYPE;
 v_execution public.automation_executions%ROWTYPE;
 v_flow public.automation_flows%ROWTYPE;
 v_version public.automation_flow_versions%ROWTYPE;
 v_event public.automation_event_inbox%ROWTYPE;
 v_owner jsonb;
 v_node jsonb;
 v_stage_id uuid;
 v_deal_id uuid;
 v_deal public.crm_records%ROWTYPE;
 v_target public.crm_records%ROWTYPE;
 v_receipt text;
 v_new jsonb;
BEGIN
 IF p_workspace_id IS NULL OR p_action_id IS NULL OR p_claim_token IS NULL
 OR p_expected_revision IS NULL OR p_expected_revision<0
 THEN RAISE EXCEPTION 'CRM_ACTION_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.automation_action_outbox
 WHERE id=p_action_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_ACTION_UNKNOWN' USING ERRCODE='P0002'; END IF;
 IF a.action_type<>'crm_stage_change'
 THEN RAISE EXCEPTION 'CRM_ACTION_TYPE_UNSUPPORTED' USING ERRCODE='42501'; END IF;
 v_receipt:='crm:'||a.action_key;
 IF a.state='sent' AND a.provider_result_id=v_receipt
 THEN RETURN jsonb_build_object('outcome','duplicate_noop','dispatchAuthorized',false); END IF;
 IF a.state<>'leased' OR a.claim_token IS DISTINCT FROM p_claim_token
 OR a.lease_until IS NULL OR a.lease_until<clock_timestamp()
 THEN RAISE EXCEPTION 'CRM_ACTION_LEASE_INVALID' USING ERRCODE='42501'; END IF;
 -- Shared row locks serialize this mutation against emergency-stop and
 -- owner changes. A stop/cutover cannot interleave after preflight.
 PERFORM 1 FROM public.automation_runtime_settings st
 JOIN public.automation_workspaces w ON w.id=st.workspace_id
 JOIN public.automation_channel_ownership own ON own.workspace_id=w.id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active
   AND st.mode='live' AND st.emergency_stop IS FALSE
   AND own.channel='crm' AND own.owner='new_engine'
 FOR SHARE OF st,w,own;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_ACTION_RUNTIME_FENCE_DENIED'
   USING ERRCODE='42501'; END IF;
 v_owner:=public.automation_channel_cutover_preflight(p_workspace_id,'crm');
 IF v_owner->>'eligible'<>'true' OR v_owner->>'dispatchAuthorized'<>'false'
 THEN RAISE EXCEPTION 'CRM_ACTION_CHANNEL_NOT_RELEASED' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_execution FROM public.automation_executions
 WHERE workspace_id=p_workspace_id AND id=a.execution_id;
 IF NOT FOUND OR v_execution.state<>'running'
 THEN RAISE EXCEPTION 'CRM_ACTION_EXECUTION_NOT_RUNNING' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_version FROM public.automation_flow_versions
 WHERE id=v_execution.flow_version_id AND workspace_id=p_workspace_id AND status='published';
 SELECT * INTO v_flow FROM public.automation_flows
 WHERE id=v_version.flow_id AND workspace_id=p_workspace_id AND enabled;
 IF v_version.id IS NULL OR v_flow.id IS NULL OR
 v_flow.published_version_id IS DISTINCT FROM v_version.id
 THEN RAISE EXCEPTION 'CRM_ACTION_VERSION_NOT_CURRENT' USING ERRCODE='42501'; END IF;
 IF v_version.published_by IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.crm_members m WHERE m.user_id=v_version.published_by)
 THEN RAISE EXCEPTION 'CRM_ACTION_PUBLISHER_MEMBERSHIP_MISSING'
   USING ERRCODE='42501'; END IF;
 SELECT n INTO v_node FROM jsonb_array_elements(v_version.graph_json->'nodes') n
 WHERE n->>'id'=a.node_id AND n->>'type'='crm_stage_change';
 IF v_node IS NULL OR
 (v_node->'config'->>'target_stage_id') IS NULL OR
 (v_node->'config'->>'target_stage_id') !~
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'CRM_ACTION_GRAPH_CONFIG_INVALID' USING ERRCODE='42501'; END IF;
 v_stage_id:=(v_node->'config'->>'target_stage_id')::uuid;
 SELECT * INTO v_target FROM public.crm_records
 WHERE id=v_stage_id AND kind='stage' AND NOT deleted;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_ACTION_STAGE_MISSING' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_event FROM public.automation_event_inbox
 WHERE id=v_execution.inbox_id AND workspace_id=p_workspace_id;
 IF NOT FOUND OR v_event.context_refs->>'opportunity_id' IS NULL OR
   (v_event.context_refs->>'opportunity_id') !~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'CRM_ACTION_OPPORTUNITY_UNBOUND' USING ERRCODE='42501'; END IF;
 v_deal_id:=(v_event.context_refs->>'opportunity_id')::uuid;
 SELECT * INTO v_deal FROM public.crm_records
 WHERE id=v_deal_id AND kind='deal' AND NOT deleted FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CRM_ACTION_DEAL_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF v_deal.revision<>p_expected_revision
 THEN RAISE EXCEPTION 'CRM_ACTION_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
 IF v_deal.data->>'stage_id' IS DISTINCT FROM v_stage_id::text THEN
   v_new:=jsonb_set(v_deal.data,'{stage_id}',to_jsonb(v_stage_id::text),true);
   UPDATE public.crm_records SET data=v_new,revision=revision+1,
     updated_at=clock_timestamp()
     WHERE id=v_deal.id AND revision=p_expected_revision;
   IF NOT FOUND THEN RAISE EXCEPTION 'CRM_ACTION_REVISION_CONFLICT' USING ERRCODE='40001'; END IF;
   INSERT INTO public.crm_history(actor,record_id,before_data,before_deleted,after_revision)
      VALUES(v_version.published_by,v_deal.id,v_deal.data,v_deal.deleted,v_deal.revision+1);
   INSERT INTO public.crm_events(deal_id,event_type,actor,actor_label,detail)
      VALUES(v_deal.id,'stage_changed',v_version.published_by,'ORYNEO Automações',
       jsonb_build_object('from',v_deal.data->>'stage_id',
         'to',v_stage_id::text,'automation_action_key',a.action_key));
 END IF;
 PERFORM public.automation_delivery_finish(p_workspace_id,p_action_id,p_claim_token,
   'sent',v_receipt);
 RETURN jsonb_build_object('outcome',
   CASE WHEN v_deal.data->>'stage_id'=v_stage_id::text THEN 'already_at_target'
     ELSE 'stage_changed' END,
   'actionId',p_action_id,'dispatchAuthorized',false);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_crm_stage_action(uuid,uuid,uuid,bigint)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_crm_stage_action(uuid,uuid,uuid,bigint)
 TO service_role;


-- Source: supabase/automation/commercial_crm_task_adapter.preview.sql (blob 756dc57f7ef0f8771463923d462a93890d893349)
-- Macro 3: CRM's existing single next_action adapter. Preview for isolated QA ONLY.
-- Never overwrites an open human task, never dispatches email/WhatsApp/Stripe.
-- The exact action text/offset come from an immutable published graph.

CREATE OR REPLACE FUNCTION public.automation_crm_task_action(
 p_workspace_id uuid,p_action_id uuid,p_claim_token uuid,p_expected_revision bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 a public.automation_action_outbox%ROWTYPE;
 e public.automation_executions%ROWTYPE;
 v public.automation_flow_versions%ROWTYPE;
 f public.automation_flows%ROWTYPE;
 i public.automation_event_inbox%ROWTYPE;
 d public.crm_records%ROWTYPE;
 n jsonb;
 v_title text;
 v_offset integer;
 v_deal_id uuid;
 v_next jsonb;
 v_receipt text;
BEGIN
 IF p_workspace_id IS NULL OR p_action_id IS NULL OR p_claim_token IS NULL
 OR p_expected_revision IS NULL OR p_expected_revision<0
 THEN RAISE EXCEPTION 'TASK_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO a FROM public.automation_action_outbox
 WHERE workspace_id=p_workspace_id AND id=p_action_id FOR UPDATE;
 IF NOT FOUND OR a.action_type<>'crm_task'
 THEN RAISE EXCEPTION 'TASK_ACTION_INVALID' USING ERRCODE='42501'; END IF;
 v_receipt:='crm:'||a.action_key;
 IF a.state='sent' AND a.provider_result_id=v_receipt
 THEN RETURN jsonb_build_object('outcome','duplicate_noop','dispatchAuthorized',false); END IF;
 IF a.state<>'leased' OR a.claim_token IS DISTINCT FROM p_claim_token
 OR a.lease_until<clock_timestamp() OR a.lease_until IS NULL
 THEN RAISE EXCEPTION 'TASK_ACTION_FENCE_DENIED' USING ERRCODE='42501'; END IF;
 -- Locks serialize kill switch and legacy owner revocation with local mutation.
 PERFORM 1 FROM public.automation_runtime_settings st
 JOIN public.automation_workspaces w ON w.id=st.workspace_id
 JOIN public.automation_channel_ownership own ON own.workspace_id=w.id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active
  AND st.mode='live' AND NOT st.emergency_stop
  AND own.channel='crm' AND own.owner='new_engine'
  AND own.release_approved_at IS NOT NULL
  AND own.legacy_dispatch_paused_at IS NOT NULL
 FOR SHARE OF st,w,own;
 IF NOT FOUND THEN RAISE EXCEPTION 'TASK_OWNER_NOT_RELEASED' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.automation_executions
 WHERE id=a.execution_id AND workspace_id=p_workspace_id AND state='running';
 IF NOT FOUND THEN RAISE EXCEPTION 'TASK_EXECUTION_NOT_RUNNING' USING ERRCODE='42501'; END IF;
 SELECT * INTO v FROM public.automation_flow_versions
 WHERE id=e.flow_version_id AND workspace_id=p_workspace_id AND status='published';
 IF NOT FOUND OR v.published_by IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.crm_members c WHERE c.user_id=v.published_by)
 THEN RAISE EXCEPTION 'TASK_PUBLISHER_INVALID' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM public.automation_flows
 WHERE id=v.flow_id AND workspace_id=p_workspace_id AND enabled
  AND published_version_id=v.id;
 IF NOT FOUND THEN RAISE EXCEPTION 'TASK_FLOW_NOT_CURRENT' USING ERRCODE='42501'; END IF;
 SELECT x INTO n FROM jsonb_array_elements(v.graph_json->'nodes') x
 WHERE x->>'id'=a.node_id AND x->>'type'='crm_task';
 IF n IS NULL OR jsonb_typeof(n->'config')<>'object'
 THEN RAISE EXCEPTION 'TASK_NODE_UNVERIFIED' USING ERRCODE='42501'; END IF;
 IF NOT ((n->'config') ? 'title') THEN
   RAISE EXCEPTION 'TASK_TITLE_MISSING' USING ERRCODE='42501'; END IF;
 v_title:=btrim(n->'config'->>'title');
 IF v_title IS NULL OR length(v_title) NOT BETWEEN 1 AND 160
 OR (SELECT count(*) FROM jsonb_object_keys(n->'config'))<>2
 OR (n->'config'->>'due_offset_minutes') !~ '^[0-9]{1,5}$'
 THEN RAISE EXCEPTION 'TASK_CONFIG_NOT_VALIDATED' USING ERRCODE='42501'; END IF;
 v_offset:=(n->'config'->>'due_offset_minutes')::integer;
 IF v_offset NOT BETWEEN 1 AND 43200
 THEN RAISE EXCEPTION 'TASK_DUE_OFFSET_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO i FROM public.automation_event_inbox
 WHERE id=e.inbox_id AND workspace_id=p_workspace_id;
 IF NOT FOUND OR i.context_refs->>'opportunity_id' IS NULL
 OR i.context_refs->>'opportunity_id' !~
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'TASK_OPPORTUNITY_MISSING' USING ERRCODE='42501'; END IF;
 v_deal_id:=(i.context_refs->>'opportunity_id')::uuid;
 SELECT * INTO d FROM public.crm_records
 WHERE id=v_deal_id AND kind='deal' AND NOT deleted FOR UPDATE;
 IF NOT FOUND OR d.revision<>p_expected_revision
 THEN RAISE EXCEPTION 'TASK_DEAL_CAS_CONFLICT' USING ERRCODE='40001'; END IF;
 -- Canonical CRM has only one next_action. Never overwrite an unfinished
 -- human task; don't silently convert a single task into a multi-task list.
 IF d.data->'next_action' IS NOT NULL AND
  d.data->'next_action'->>'done' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'TASK_OPEN_HUMAN_ACTION_EXISTS' USING ERRCODE='42501'; END IF;
 v_next:=jsonb_build_object('title',v_title,'due_at',
   clock_timestamp()+make_interval(mins=>v_offset),'done',false);
 UPDATE public.crm_records SET
  data=jsonb_set(d.data,'{next_action}',v_next,true),
  revision=revision+1,updated_at=clock_timestamp()
 WHERE id=d.id AND revision=d.revision;
 IF NOT FOUND THEN RAISE EXCEPTION 'TASK_DEAL_CAS_CONFLICT' USING ERRCODE='40001'; END IF;
 INSERT INTO public.crm_history(actor,record_id,before_data,before_deleted,after_revision)
 VALUES(v.published_by,d.id,d.data,d.deleted,d.revision+1);
 INSERT INTO public.crm_events(deal_id,event_type,actor,actor_label,detail)
 VALUES(d.id,'activity',v.published_by,'ORYNEO Automações',
  jsonb_build_object('automation_action_key',a.action_key,'action_code','task_created'));
 PERFORM public.automation_delivery_finish(
  p_workspace_id,p_action_id,p_claim_token,'sent',v_receipt);
 RETURN jsonb_build_object('outcome','task_created','dispatchAuthorized',false);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_crm_task_action(uuid,uuid,uuid,bigint)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_crm_task_action(uuid,uuid,uuid,bigint)
 TO service_role;

COMMIT;
