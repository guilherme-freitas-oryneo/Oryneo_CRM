-- ORYNEO Stage 2 — durable live-engine primitives and reviewed channel catalog.
-- Additive and dormant: this migration never changes runtime mode, ownership,
-- flow publication, provider settings, cron schedules or legacy workers.
BEGIN;

CREATE TABLE IF NOT EXISTS public.automation_email_template_registry (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
 subject_template text NOT NULL CHECK(length(subject_template) BETWEEN 1 AND 200),
 body_text_template text NOT NULL CHECK(length(body_text_template) BETWEEN 1 AND 20000),
 purpose text NOT NULL CHECK(purpose IN('diagnosis','proposal','commercial_followup','transactional')),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','retired')),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 approved_by uuid,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,name),
 CONSTRAINT automation_email_template_approval CHECK(
   status<>'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
ALTER TABLE public.automation_email_template_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_email_template_registry FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_email_template_registry TO service_role;

CREATE TABLE IF NOT EXISTS public.automation_sdr_reply_registry (
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 text_ref text NOT NULL CHECK(text_ref ~ '^[a-z0-9][a-z0-9_.-]{2,127}$'),
 body_text text NOT NULL CHECK(length(body_text) BETWEEN 1 AND 4096),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','retired')),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 approved_by uuid,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,text_ref),
 CONSTRAINT automation_sdr_reply_approval CHECK(
   status<>'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
ALTER TABLE public.automation_sdr_reply_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_sdr_reply_registry FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_sdr_reply_registry TO service_role;

CREATE TABLE IF NOT EXISTS public.automation_email_consents (
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 opportunity_id uuid NOT NULL REFERENCES public.crm_records(id) ON DELETE RESTRICT,
 purpose text NOT NULL CHECK(purpose IN('diagnosis','proposal','commercial_followup','transactional')),
 recipient_sha256 text NOT NULL CHECK(recipient_sha256 ~ '^[0-9a-f]{64}$'),
 proof_kind text NOT NULL CHECK(proof_kind IN('opt_in_form','signed_agreement','explicit_inbound','contractual_transaction')),
 proof_sha256 text NOT NULL CHECK(proof_sha256 ~ '^[0-9a-f]{64}$'),
 granted_at timestamptz NOT NULL,
 verified_by uuid NOT NULL,
 verified_at timestamptz NOT NULL,
 revoked_at timestamptz,
 revoke_reason text CHECK(revoke_reason IS NULL OR length(revoke_reason) BETWEEN 3 AND 160),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,opportunity_id,purpose),
 CONSTRAINT automation_email_consent_verified CHECK(verified_at>=granted_at),
 CONSTRAINT automation_email_consent_revoked CHECK(revoked_at IS NULL OR revoked_at>=granted_at)
);
ALTER TABLE public.automation_email_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_email_consents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_email_consents TO service_role;
CREATE INDEX IF NOT EXISTS automation_email_consents_active_idx
 ON public.automation_email_consents(workspace_id,opportunity_id,purpose)
 WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.automation_email_provider_bindings (
 workspace_id uuid PRIMARY KEY REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 mailbox_id uuid NOT NULL REFERENCES public.crm_mailboxes(id) ON DELETE RESTRICT,
 verified_by uuid,
 verified_at timestamptz,
 release_approved_by uuid,
 release_approved_at timestamptz,
 enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT automation_email_provider_release CHECK(NOT enabled OR
  (verified_by IS NOT NULL AND verified_at IS NOT NULL
   AND release_approved_by IS NOT NULL AND release_approved_at>=verified_at))
);
ALTER TABLE public.automation_email_provider_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_email_provider_bindings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_email_provider_bindings TO service_role;
CREATE INDEX IF NOT EXISTS automation_email_provider_mailbox_idx
 ON public.automation_email_provider_bindings(mailbox_id);

CREATE TABLE IF NOT EXISTS public.automation_consent_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 channel text NOT NULL CHECK(channel IN('email','whatsapp')),
 subject_id uuid NOT NULL,
 purpose text NOT NULL CHECK(length(purpose) BETWEEN 3 AND 64),
 action text NOT NULL CHECK(action='revoked'),
 actor_id uuid NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.automation_consent_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_consent_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.automation_consent_audit TO service_role;
CREATE INDEX IF NOT EXISTS automation_consent_audit_workspace_idx
 ON public.automation_consent_audit(workspace_id,occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.automation_live_waits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL,
 execution_id uuid NOT NULL,
 node_id text NOT NULL CHECK(node_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 conversation_id uuid REFERENCES public.crm_wa_conversations(id) ON DELETE RESTRICT,
 due_at timestamptz NOT NULL,
 cancel_on_reply boolean NOT NULL,
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN('waiting','leased','cancelled','resumed','dead_letter')),
 claim_token uuid,
 lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 reason_code text,
 observed_reply_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT automation_live_wait_execution_fk FOREIGN KEY(workspace_id,execution_id)
   REFERENCES public.automation_executions(workspace_id,id) ON DELETE RESTRICT,
 CONSTRAINT automation_live_wait_conversation_required CHECK(NOT cancel_on_reply OR conversation_id IS NOT NULL),
 CONSTRAINT automation_live_wait_lease_shape CHECK(
   (state='leased' AND claim_token IS NOT NULL AND lease_until IS NOT NULL)
   OR (state<>'leased' AND claim_token IS NULL AND lease_until IS NULL)),
 UNIQUE(execution_id,node_id)
);
ALTER TABLE public.automation_live_waits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_live_waits FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.automation_live_waits TO service_role;
CREATE INDEX IF NOT EXISTS automation_live_waits_due_idx
 ON public.automation_live_waits(workspace_id,due_at,id)
 WHERE state='waiting';
CREATE INDEX IF NOT EXISTS automation_live_waits_lease_idx
 ON public.automation_live_waits(workspace_id,lease_until,id)
 WHERE state='leased';
CREATE INDEX IF NOT EXISTS automation_live_waits_execution_fk_idx
 ON public.automation_live_waits(workspace_id,execution_id);
CREATE INDEX IF NOT EXISTS automation_live_waits_conversation_idx
 ON public.automation_live_waits(workspace_id,conversation_id,state)
 WHERE conversation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.automation_live_wait_register(
 p_workspace_id uuid,p_execution_id uuid,p_node_id text
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE ex public.automation_executions%ROWTYPE; inbox public.automation_event_inbox%ROWTYPE;
 graph jsonb; node jsonb; minutes integer; cancel_reply boolean; conversation uuid; result uuid;
BEGIN
 IF p_workspace_id IS NULL OR p_execution_id IS NULL
  OR p_node_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'LIVE_WAIT_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO ex FROM public.automation_executions
  WHERE workspace_id=p_workspace_id AND id=p_execution_id FOR UPDATE;
 IF NOT FOUND OR ex.state NOT IN('running','waiting')
 THEN RAISE EXCEPTION 'LIVE_WAIT_EXECUTION_INACTIVE' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
   JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
   WHERE w.id=p_workspace_id AND w.active AND s.mode='live' AND NOT s.emergency_stop)
 THEN RAISE EXCEPTION 'LIVE_WAIT_RUNTIME_STOPPED' USING ERRCODE='42501'; END IF;
 SELECT v.graph_json INTO graph FROM public.automation_flow_versions v
  JOIN public.automation_flows f ON f.id=v.flow_id AND f.workspace_id=v.workspace_id
   AND f.enabled AND f.published_version_id=v.id
  WHERE v.id=ex.flow_version_id AND v.workspace_id=p_workspace_id AND v.status='published';
 IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_WAIT_VERSION_DRIFT' USING ERRCODE='42501'; END IF;
 SELECT * INTO inbox FROM public.automation_event_inbox
  WHERE id=ex.inbox_id AND workspace_id=ex.workspace_id;
 IF NOT FOUND OR NOT (inbox.state='processed' OR
   (inbox.state='pending' AND inbox.lease_token IS NOT NULL
    AND inbox.lease_until>clock_timestamp()))
 THEN RAISE EXCEPTION 'LIVE_WAIT_EVENT_DRIFT' USING ERRCODE='42501'; END IF;
 SELECT value INTO node FROM jsonb_array_elements(graph->'nodes')
  WHERE value->>'id'=p_node_id AND value->>'type'='wait' LIMIT 1;
 IF node IS NULL OR jsonb_typeof(node->'config')<>'object'
  OR (node->'config'->>'duration_minutes') !~ '^[0-9]{1,5}$'
  OR jsonb_typeof(node->'config'->'cancel_on_reply')<>'boolean'
 THEN RAISE EXCEPTION 'LIVE_WAIT_NODE_UNVERIFIED' USING ERRCODE='42501'; END IF;
 minutes:=(node->'config'->>'duration_minutes')::integer;
 cancel_reply:=(node->'config'->>'cancel_on_reply')::boolean;
 IF minutes NOT BETWEEN 1 AND 43200
 THEN RAISE EXCEPTION 'LIVE_WAIT_DURATION_INVALID' USING ERRCODE='22023'; END IF;
 IF inbox.context_refs->>'conversation_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN conversation:=(inbox.context_refs->>'conversation_id')::uuid; END IF;
 IF cancel_reply AND conversation IS NULL
 THEN RAISE EXCEPTION 'LIVE_WAIT_CONVERSATION_REQUIRED' USING ERRCODE='42501'; END IF;
 INSERT INTO public.automation_live_waits
  (workspace_id,execution_id,node_id,conversation_id,due_at,cancel_on_reply)
 VALUES(p_workspace_id,ex.id,p_node_id,conversation,
  clock_timestamp()+make_interval(mins=>minutes),cancel_reply)
 ON CONFLICT(execution_id,node_id) DO NOTHING RETURNING id INTO result;
 IF result IS NULL THEN
  SELECT id INTO result FROM public.automation_live_waits
   WHERE execution_id=ex.id AND node_id=p_node_id;
 END IF;
 UPDATE public.automation_executions SET state='waiting' WHERE id=ex.id AND state='running';
 RETURN result;
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_live_wait_cancel_reply(
 p_workspace_id uuid,p_conversation_id uuid
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE changed integer;
BEGIN
 IF p_workspace_id IS NULL OR p_conversation_id IS NULL
 THEN RAISE EXCEPTION 'LIVE_WAIT_CANCEL_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 WITH candidates AS(
  SELECT wait.id,(SELECT m.id FROM public.crm_wa_messages m
   WHERE m.conversation_id=wait.conversation_id AND m.direction='inbound'
    AND m.reaction_to_provider_message_id IS NULL AND m.occurred_at>=wait.created_at
   ORDER BY m.occurred_at,m.id LIMIT 1) reply_id
  FROM public.automation_live_waits wait
  WHERE wait.workspace_id=p_workspace_id AND wait.conversation_id=p_conversation_id
   AND wait.cancel_on_reply AND wait.state='waiting'
  FOR UPDATE OF wait SKIP LOCKED
 ), cancelled AS(
  UPDATE public.automation_live_waits wait SET state='cancelled',
   reason_code='CANONICAL_INBOUND_RECEIVED',observed_reply_id=c.reply_id,
   updated_at=clock_timestamp()
  FROM candidates c WHERE wait.id=c.id AND c.reply_id IS NOT NULL RETURNING wait.id
 ) SELECT count(*) INTO changed FROM cancelled;
 UPDATE public.automation_executions ex SET state='cancelled',finished_at=clock_timestamp()
  WHERE ex.workspace_id=p_workspace_id AND ex.state='waiting'
   AND EXISTS(SELECT 1 FROM public.automation_live_waits wait
    WHERE wait.execution_id=ex.id AND wait.state='cancelled'
      AND wait.reason_code='CANONICAL_INBOUND_RECEIVED');
 RETURN changed;
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_live_wait_claim(
 p_workspace_id uuid,p_limit integer DEFAULT 10
) RETURNS TABLE(wait_id uuid,execution_id uuid,node_id text,claim_token uuid)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION 'LIVE_WAIT_CLAIM_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
  WHERE w.id=p_workspace_id AND w.active AND s.mode='live' AND NOT s.emergency_stop)
 THEN RETURN; END IF;
 PERFORM public.automation_live_wait_cancel_reply(p_workspace_id,c.id)
  FROM (SELECT DISTINCT conversation_id AS id FROM public.automation_live_waits
    WHERE workspace_id=p_workspace_id AND state='waiting' AND cancel_on_reply
      AND conversation_id IS NOT NULL) c;
 RETURN QUERY WITH due AS(
  SELECT wait.id FROM public.automation_live_waits wait
  JOIN public.automation_executions ex ON ex.id=wait.execution_id
   AND ex.workspace_id=wait.workspace_id AND ex.state='waiting'
  WHERE wait.workspace_id=p_workspace_id AND wait.state='waiting'
   AND wait.due_at<=clock_timestamp() AND wait.attempts<5
  ORDER BY wait.due_at,wait.id LIMIT p_limit FOR UPDATE OF wait SKIP LOCKED
 ), leased AS(
  UPDATE public.automation_live_waits wait SET state='leased',claim_token=gen_random_uuid(),
   lease_until=clock_timestamp()+interval '90 seconds',attempts=wait.attempts+1,
   updated_at=clock_timestamp() FROM due WHERE wait.id=due.id
  RETURNING wait.id,wait.execution_id,wait.node_id,wait.claim_token
 ) SELECT leased.id,leased.execution_id,leased.node_id,leased.claim_token FROM leased;
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_live_wait_recover(
 p_workspace_id uuid,p_limit integer DEFAULT 20
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE changed integer;
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
 THEN RAISE EXCEPTION 'LIVE_WAIT_RECOVER_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 WITH stale AS(SELECT id FROM public.automation_live_waits
  WHERE workspace_id=p_workspace_id AND state='leased' AND lease_until<clock_timestamp()
  ORDER BY lease_until,id LIMIT p_limit FOR UPDATE SKIP LOCKED), recovered AS(
  UPDATE public.automation_live_waits wait SET
   state=CASE WHEN wait.attempts>=5 THEN 'dead_letter' ELSE 'waiting' END,
   reason_code=CASE WHEN wait.attempts>=5 THEN 'LIVE_WAIT_ATTEMPTS_EXHAUSTED' ELSE 'LIVE_WAIT_LEASE_RECOVERED' END,
   claim_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
  FROM stale WHERE wait.id=stale.id RETURNING wait.id)
 SELECT count(*) INTO changed FROM recovered;
 RETURN changed;
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_live_wait_finish(
 p_workspace_id uuid,p_wait_id uuid,p_claim_token uuid,p_decision jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE wait public.automation_live_waits%ROWTYPE; ex public.automation_executions%ROWTYPE;
 graph jsonb; step jsonb; previous_step jsonb; expected_first text; action jsonb;
 action_type text; action_node text; expected_key text; activation text; channel text;
BEGIN
 IF p_workspace_id IS NULL OR p_wait_id IS NULL OR p_claim_token IS NULL
  OR p_decision IS NULL OR jsonb_typeof(p_decision)<>'object'
  OR p_decision->>'dispatchAuthorized' IS DISTINCT FROM 'false'
  OR p_decision->>'state' IS NULL
  OR p_decision->>'state' NOT IN('completed','waiting','awaiting_server_outcome')
  OR jsonb_typeof(p_decision->'trace') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_decision->'trace') NOT BETWEEN 1 AND 200
  OR jsonb_typeof(p_decision->'plannedActions') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_decision->'plannedActions')>1
 THEN RAISE EXCEPTION 'LIVE_WAIT_FINISH_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO wait FROM public.automation_live_waits
  WHERE workspace_id=p_workspace_id AND id=p_wait_id FOR UPDATE;
 IF NOT FOUND OR wait.state<>'leased' OR wait.claim_token IS DISTINCT FROM p_claim_token
  OR wait.lease_until<=clock_timestamp()
 THEN RAISE EXCEPTION 'LIVE_WAIT_LEASE_STALE' USING ERRCODE='42501'; END IF;
 SELECT * INTO ex FROM public.automation_executions
  WHERE workspace_id=p_workspace_id AND id=wait.execution_id FOR UPDATE;
 IF NOT FOUND OR ex.state<>'waiting'
 THEN RAISE EXCEPTION 'LIVE_WAIT_EXECUTION_STALE' USING ERRCODE='42501'; END IF;
 SELECT v.graph_json INTO graph FROM public.automation_flow_versions v
  JOIN public.automation_flows f ON f.id=v.flow_id AND f.workspace_id=v.workspace_id
   AND f.enabled AND f.published_version_id=v.id
  WHERE v.workspace_id=p_workspace_id AND v.id=ex.flow_version_id AND v.status='published';
 IF graph IS NULL OR NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
  WHERE w.id=p_workspace_id AND w.active AND s.mode='live' AND NOT s.emergency_stop)
 THEN RAISE EXCEPTION 'LIVE_WAIT_RELEASE_REVOKED' USING ERRCODE='42501'; END IF;
 SELECT value->>'target' INTO expected_first FROM jsonb_array_elements(graph->'edges')
  WHERE value->>'source'=wait.node_id AND value->>'source_port'='timeout' LIMIT 1;
 FOR step IN SELECT value FROM jsonb_array_elements(p_decision->'trace') LOOP
  IF previous_step IS NULL THEN
   IF step->>'nodeId' IS DISTINCT FROM expected_first
   THEN RAISE EXCEPTION 'LIVE_WAIT_TRACE_START_INVALID' USING ERRCODE='42501'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph->'edges') edge
   WHERE edge->>'source'=previous_step->>'nodeId'
    AND edge->>'source_port'=coalesce(previous_step->>'nextPort','out')
    AND edge->>'target'=step->>'nodeId')
  THEN RAISE EXCEPTION 'LIVE_WAIT_TRACE_EDGE_INVALID' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph->'nodes') node
    WHERE node->>'id'=step->>'nodeId' AND node->>'type'=step->>'type')
  THEN RAISE EXCEPTION 'LIVE_WAIT_TRACE_NODE_INVALID' USING ERRCODE='42501'; END IF;
  previous_step:=step;
 END LOOP;
 activation:=encode(sha256(convert_to(array_to_json(ARRAY[p_workspace_id::text,
   ex.flow_version_id::text,(SELECT source FROM public.automation_event_inbox WHERE id=ex.inbox_id),
   (SELECT event_id FROM public.automation_event_inbox WHERE id=ex.inbox_id)])::text,'UTF8')),'hex');
 IF p_decision->>'activationKey' IS DISTINCT FROM activation
 THEN RAISE EXCEPTION 'LIVE_WAIT_ACTIVATION_INVALID' USING ERRCODE='42501'; END IF;
 IF p_decision->>'state'='completed' THEN
  IF jsonb_array_length(p_decision->'plannedActions')<>0
   OR p_decision->'trace'->-1->>'type' NOT IN('end','stop')
  THEN RAISE EXCEPTION 'LIVE_WAIT_TERMINAL_INVALID' USING ERRCODE='42501'; END IF;
  UPDATE public.automation_executions SET state='completed',finished_at=clock_timestamp() WHERE id=ex.id;
 ELSIF p_decision->>'state'='waiting' THEN
  IF jsonb_array_length(p_decision->'plannedActions')<>0 OR p_decision->'trace'->-1->>'type'<>'wait'
  THEN RAISE EXCEPTION 'LIVE_WAIT_NESTED_INVALID' USING ERRCODE='42501'; END IF;
  UPDATE public.automation_executions SET state='running' WHERE id=ex.id;
  PERFORM public.automation_live_wait_register(p_workspace_id,ex.id,previous_step->>'nodeId');
 ELSE
  action:=p_decision->'plannedActions'->0; action_type:=action->>'type';action_node:=action->>'nodeId';
  IF action_type NOT IN('crm_stage_change','crm_task','whatsapp_template','whatsapp_reply','email')
   OR action_node IS DISTINCT FROM previous_step->>'nodeId' OR (action->>'actionKey') !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'LIVE_WAIT_ACTION_INVALID' USING ERRCODE='42501'; END IF;
  expected_key:=encode(sha256(convert_to(array_to_json(ARRAY[activation,action_node,action_type])::text,'UTF8')),'hex');
  IF action->>'actionKey' IS DISTINCT FROM expected_key
  THEN RAISE EXCEPTION 'LIVE_WAIT_ACTION_KEY_INVALID' USING ERRCODE='42501'; END IF;
  channel:=CASE WHEN action_type LIKE 'crm_%' THEN 'crm'
   WHEN action_type LIKE 'whatsapp_%' THEN 'whatsapp' ELSE 'email' END;
  IF EXISTS(SELECT 1 FROM public.automation_release_missing_gates(p_workspace_id,channel))
   OR NOT EXISTS(SELECT 1 FROM public.automation_channel_ownership owner
    WHERE owner.workspace_id=p_workspace_id AND owner.channel=channel
     AND owner.owner='new_engine' AND owner.legacy_dispatch_paused_at IS NOT NULL
     AND owner.release_approved_at IS NOT NULL AND owner.release_id IS NOT NULL)
  THEN RAISE EXCEPTION 'LIVE_WAIT_CHANNEL_PREFLIGHT_DENIED' USING ERRCODE='42501'; END IF;
  UPDATE public.automation_executions SET state='running' WHERE id=ex.id;
  INSERT INTO public.automation_action_outbox
   (workspace_id,execution_id,node_id,action_key,action_type,state)
  VALUES(p_workspace_id,ex.id,action_node,expected_key,action_type,'queued')
  ON CONFLICT(workspace_id,action_key) DO NOTHING;
 END IF;
 UPDATE public.automation_live_waits SET state='resumed',claim_token=NULL,lease_until=NULL,
  reason_code='LIVE_WAIT_RESUMED',updated_at=clock_timestamp() WHERE id=wait.id;
 RETURN jsonb_build_object('ok',true,'resumed',true,'dispatchAuthorized',false);
END $fn$;

-- Atomic planner commit for batches that may suspend on a wait. It repeats
-- immutable graph, trace, action-key and channel release checks inside SQL.
CREATE OR REPLACE FUNCTION public.automation_live_engine_finish(
 p_workspace_id uuid,p_inbox_id uuid,p_lease_token uuid,p_plans jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 inbox public.automation_event_inbox%ROWTYPE; plan jsonb; decision jsonb;
 version public.automation_flow_versions%ROWTYPE; step jsonb; previous jsonb; node jsonb;
 action jsonb; execution_id uuid; version_id uuid; activation text; expected_key text;
 action_type text;action_node text;channel text;required_count integer;flow_count integer:=0;
BEGIN
 IF p_workspace_id IS NULL OR p_inbox_id IS NULL OR p_lease_token IS NULL
  OR jsonb_typeof(p_plans) IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_plans)>20 OR octet_length(p_plans::text)>131072
 THEN RAISE EXCEPTION 'LIVE_ENGINE_FINISH_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO inbox FROM public.automation_event_inbox
  WHERE id=p_inbox_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR inbox.state<>'pending' OR inbox.lease_token IS DISTINCT FROM p_lease_token
  OR inbox.lease_until IS NULL OR inbox.lease_until<clock_timestamp()
 THEN RAISE EXCEPTION 'LIVE_ENGINE_INBOX_LEASE_STALE' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings settings ON settings.workspace_id=w.id
  WHERE w.id=p_workspace_id AND w.active AND settings.mode='live' AND NOT settings.emergency_stop)
 THEN RAISE EXCEPTION 'LIVE_ENGINE_RUNTIME_STOPPED' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO required_count FROM public.automation_flows flow
  JOIN public.automation_flow_versions fv ON fv.id=flow.published_version_id
   AND fv.workspace_id=flow.workspace_id AND fv.status='published'
  WHERE flow.workspace_id=p_workspace_id AND flow.enabled
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(fv.graph_json->'nodes') graph_node
    WHERE graph_node->>'type'='trigger'
     AND graph_node->'config'->>'event_type'=inbox.event_type);
 IF required_count<>jsonb_array_length(p_plans)
 THEN RAISE EXCEPTION 'LIVE_ENGINE_PLANS_INCOMPLETE' USING ERRCODE='22023'; END IF;
 FOR plan IN SELECT value FROM jsonb_array_elements(p_plans) LOOP
  IF jsonb_typeof(plan) IS DISTINCT FROM 'object'
   OR (plan->>'flowVersionId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  THEN RAISE EXCEPTION 'LIVE_ENGINE_VERSION_INVALID' USING ERRCODE='22023'; END IF;
  version_id:=(plan->>'flowVersionId')::uuid;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_plans) duplicated
    WHERE duplicated->>'flowVersionId'=plan->>'flowVersionId'
    GROUP BY duplicated->>'flowVersionId' HAVING count(*)>1)
  THEN RAISE EXCEPTION 'LIVE_ENGINE_PLAN_DUPLICATED' USING ERRCODE='22023'; END IF;
  SELECT fv.* INTO version FROM public.automation_flow_versions fv
   JOIN public.automation_flows flow ON flow.published_version_id=fv.id
    AND flow.workspace_id=fv.workspace_id AND flow.enabled
   WHERE fv.id=version_id AND fv.workspace_id=p_workspace_id AND fv.status='published'
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(fv.graph_json->'nodes') graph_node
     WHERE graph_node->>'type'='trigger'
      AND graph_node->'config'->>'event_type'=inbox.event_type);
  IF NOT FOUND THEN RAISE EXCEPTION 'LIVE_ENGINE_VERSION_DRIFT' USING ERRCODE='42501'; END IF;
  decision:=plan->'decision';
  IF jsonb_typeof(decision) IS DISTINCT FROM 'object'
   OR decision->>'dispatchAuthorized' IS DISTINCT FROM 'false'
   OR decision->>'state' IS NULL
   OR decision->>'state' NOT IN('completed','waiting','awaiting_server_outcome')
   OR jsonb_typeof(decision->'trace') IS DISTINCT FROM 'array'
   OR jsonb_array_length(decision->'trace') NOT BETWEEN 1 AND 200
   OR jsonb_typeof(decision->'plannedActions') IS DISTINCT FROM 'array'
   OR jsonb_array_length(decision->'plannedActions')>1
  THEN RAISE EXCEPTION 'LIVE_ENGINE_DECISION_INVALID' USING ERRCODE='22023'; END IF;
  activation:=encode(sha256(convert_to(array_to_json(ARRAY[p_workspace_id::text,
    version.id::text,inbox.source,inbox.event_id])::text,'UTF8')),'hex');
  IF decision->>'activationKey' IS DISTINCT FROM activation
  THEN RAISE EXCEPTION 'LIVE_ENGINE_ACTIVATION_INVALID' USING ERRCODE='42501'; END IF;
  previous:=NULL;
  FOR step IN SELECT value FROM jsonb_array_elements(decision->'trace') LOOP
   SELECT value INTO node FROM jsonb_array_elements(version.graph_json->'nodes')
    WHERE value->>'id'=step->>'nodeId' AND value->>'type'=step->>'type' LIMIT 1;
   IF node IS NULL OR step->>'status' NOT IN('evaluated','completed','waiting','requires_server_result')
   THEN RAISE EXCEPTION 'LIVE_ENGINE_TRACE_NODE_INVALID' USING ERRCODE='42501'; END IF;
   IF previous IS NULL THEN
    IF node->>'type'<>'trigger'
    THEN RAISE EXCEPTION 'LIVE_ENGINE_TRACE_TRIGGER_REQUIRED' USING ERRCODE='42501'; END IF;
   ELSIF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(version.graph_json->'edges') edge
    WHERE edge->>'source'=previous->>'nodeId'
     AND edge->>'source_port'=coalesce(previous->>'nextPort','out')
     AND edge->>'target'=step->>'nodeId')
   THEN RAISE EXCEPTION 'LIVE_ENGINE_TRACE_EDGE_INVALID' USING ERRCODE='42501'; END IF;
   previous:=step;
  END LOOP;
  INSERT INTO public.automation_executions(workspace_id,flow_version_id,inbox_id,state)
  VALUES(p_workspace_id,version.id,inbox.id,'running')
  ON CONFLICT(flow_version_id,inbox_id) DO NOTHING;
  SELECT id INTO execution_id FROM public.automation_executions
   WHERE workspace_id=p_workspace_id AND flow_version_id=version.id AND inbox_id=inbox.id;
  IF decision->>'state'='completed' THEN
   IF jsonb_array_length(decision->'plannedActions')<>0
    OR previous->>'status'<>'completed' OR previous->>'type' NOT IN('end','stop')
   THEN RAISE EXCEPTION 'LIVE_ENGINE_TERMINAL_INVALID' USING ERRCODE='42501'; END IF;
   UPDATE public.automation_executions SET state='completed',finished_at=clock_timestamp()
    WHERE id=execution_id AND state='running';
  ELSIF decision->>'state'='waiting' THEN
   IF jsonb_array_length(decision->'plannedActions')<>0
    OR previous->>'status'<>'waiting' OR previous->>'type'<>'wait'
   THEN RAISE EXCEPTION 'LIVE_ENGINE_WAIT_INVALID' USING ERRCODE='42501'; END IF;
   PERFORM public.automation_live_wait_register(p_workspace_id,execution_id,previous->>'nodeId');
  ELSE
   IF jsonb_array_length(decision->'plannedActions')<>1
    OR previous->>'status'<>'requires_server_result'
   THEN RAISE EXCEPTION 'LIVE_ENGINE_ACTION_REQUIRED' USING ERRCODE='42501'; END IF;
   action:=decision->'plannedActions'->0;action_type:=action->>'type';action_node:=action->>'nodeId';
   IF action_type NOT IN('crm_stage_change','crm_task','whatsapp_template','whatsapp_reply','email')
    OR action_node IS DISTINCT FROM previous->>'nodeId'
    OR action_type IS DISTINCT FROM previous->>'type'
    OR (action->>'actionKey') !~ '^[0-9a-f]{64}$'
   THEN RAISE EXCEPTION 'LIVE_ENGINE_ACTION_INVALID' USING ERRCODE='42501'; END IF;
   expected_key:=encode(sha256(convert_to(array_to_json(ARRAY[activation,action_node,action_type])::text,'UTF8')),'hex');
   IF action->>'actionKey' IS DISTINCT FROM expected_key
   THEN RAISE EXCEPTION 'LIVE_ENGINE_ACTION_KEY_INVALID' USING ERRCODE='42501'; END IF;
   channel:=CASE WHEN action_type LIKE 'crm_%' THEN 'crm'
    WHEN action_type LIKE 'whatsapp_%' THEN 'whatsapp' ELSE 'email' END;
   IF EXISTS(SELECT 1 FROM public.automation_release_missing_gates(p_workspace_id,channel))
    OR NOT EXISTS(SELECT 1 FROM public.automation_channel_ownership owner
     WHERE owner.workspace_id=p_workspace_id AND owner.channel=channel
      AND owner.owner='new_engine' AND owner.legacy_dispatch_paused_at IS NOT NULL
      AND owner.release_approved_at IS NOT NULL AND owner.release_id IS NOT NULL)
   THEN RAISE EXCEPTION 'LIVE_ENGINE_CHANNEL_PREFLIGHT_DENIED' USING ERRCODE='42501'; END IF;
   INSERT INTO public.automation_action_outbox
    (workspace_id,execution_id,node_id,action_key,action_type,state)
   VALUES(p_workspace_id,execution_id,action_node,expected_key,action_type,'queued')
   ON CONFLICT(workspace_id,action_key) DO NOTHING;
  END IF;
  flow_count:=flow_count+1;
 END LOOP;
 UPDATE public.automation_event_inbox SET
  state=CASE WHEN flow_count=0 THEN 'ignored' ELSE 'processed' END,
  lease_token=NULL,lease_until=NULL,processed_at=clock_timestamp()
 WHERE id=inbox.id;
 RETURN jsonb_build_object('ok',true,'flowCount',flow_count,
  'externalMessagesSent',0,'paymentsCreated',0,'dispatchAuthorized',false);
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_live_crm_continue_wait(
 p_workspace_id uuid,p_execution_id uuid,p_previous_action_id uuid,p_decision jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE ex public.automation_executions%ROWTYPE;action public.automation_action_outbox%ROWTYPE;
 inbox public.automation_event_inbox%ROWTYPE;graph jsonb;step jsonb;previous text;
 expected text;activation text;wait_node text;
BEGIN
 IF p_workspace_id IS NULL OR p_execution_id IS NULL OR p_previous_action_id IS NULL
  OR jsonb_typeof(p_decision) IS DISTINCT FROM 'object'
  OR p_decision->>'dispatchAuthorized' IS DISTINCT FROM 'false'
  OR p_decision->>'state' IS DISTINCT FROM 'waiting'
  OR jsonb_typeof(p_decision->'trace') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_decision->'trace') NOT BETWEEN 1 AND 200
  OR jsonb_typeof(p_decision->'plannedActions') IS DISTINCT FROM 'array'
  OR jsonb_array_length(p_decision->'plannedActions')<>0
 THEN RAISE EXCEPTION 'LIVE_CRM_WAIT_CONTINUATION_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO ex FROM public.automation_executions
  WHERE workspace_id=p_workspace_id AND id=p_execution_id FOR UPDATE;
 SELECT * INTO action FROM public.automation_action_outbox
  WHERE workspace_id=p_workspace_id AND id=p_previous_action_id
   AND execution_id=p_execution_id FOR UPDATE;
 IF ex.state<>'running' OR action.state<>'sent'
  OR action.action_type NOT IN('crm_stage_change','crm_task')
  OR action.provider_result_id IS DISTINCT FROM 'crm:'||action.action_key
 THEN RAISE EXCEPTION 'LIVE_CRM_WAIT_RECEIPT_UNVERIFIED' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_live_crm_continuations
  WHERE execution_id=ex.id AND previous_action_id=action.id)
 THEN RETURN jsonb_build_object('ok',true,'alreadyContinued',true,'dispatchAuthorized',false); END IF;
 SELECT * INTO inbox FROM public.automation_event_inbox
  WHERE workspace_id=p_workspace_id AND id=ex.inbox_id AND state='processed';
 SELECT version.graph_json INTO graph FROM public.automation_flow_versions version
  JOIN public.automation_flows flow ON flow.id=version.flow_id AND flow.workspace_id=version.workspace_id
   AND flow.enabled AND flow.published_version_id=version.id
  WHERE version.workspace_id=p_workspace_id AND version.id=ex.flow_version_id
   AND version.status='published';
 IF inbox.id IS NULL OR graph IS NULL OR NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings settings ON settings.workspace_id=w.id
  JOIN public.automation_channel_ownership owner ON owner.workspace_id=w.id
  WHERE w.id=p_workspace_id AND w.active AND settings.mode='live' AND NOT settings.emergency_stop
   AND owner.channel='crm' AND owner.owner='new_engine'
   AND owner.legacy_dispatch_paused_at IS NOT NULL AND owner.release_approved_at IS NOT NULL)
 THEN RAISE EXCEPTION 'LIVE_CRM_WAIT_RELEASE_REVOKED' USING ERRCODE='42501'; END IF;
 SELECT value->>'target' INTO expected FROM jsonb_array_elements(graph->'edges')
  WHERE value->>'source'=action.node_id AND value->>'source_port'='out' LIMIT 1;
 FOR step IN SELECT value FROM jsonb_array_elements(p_decision->'trace') LOOP
  IF step->>'nodeId' IS DISTINCT FROM expected
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph->'nodes') node
    WHERE node->>'id'=step->>'nodeId' AND node->>'type'=step->>'type')
  THEN RAISE EXCEPTION 'LIVE_CRM_WAIT_TRACE_INVALID' USING ERRCODE='42501'; END IF;
  previous:=step->>'nodeId';
  SELECT value->>'target' INTO expected FROM jsonb_array_elements(graph->'edges')
   WHERE value->>'source'=previous
    AND value->>'source_port'=coalesce(step->>'nextPort','out') LIMIT 1;
 END LOOP;
 IF p_decision->'trace'->-1->>'type'<>'wait'
  OR p_decision->'trace'->-1->>'status'<>'waiting'
 THEN RAISE EXCEPTION 'LIVE_CRM_WAIT_TERMINAL_INVALID' USING ERRCODE='42501'; END IF;
 wait_node:=p_decision->'trace'->-1->>'nodeId';
 activation:=encode(sha256(convert_to(array_to_json(ARRAY[p_workspace_id::text,
  ex.flow_version_id::text,inbox.source,inbox.event_id])::text,'UTF8')),'hex');
 IF p_decision->>'activationKey' IS DISTINCT FROM activation
 THEN RAISE EXCEPTION 'LIVE_CRM_WAIT_ACTIVATION_INVALID' USING ERRCODE='42501'; END IF;
 INSERT INTO public.automation_live_crm_continuations
  (workspace_id,execution_id,previous_action_id,status)
 VALUES(p_workspace_id,ex.id,action.id,'continued');
 PERFORM public.automation_live_wait_register(p_workspace_id,ex.id,wait_node);
 RETURN jsonb_build_object('ok',true,'waiting',true,'dispatchAuthorized',false);
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_email_claim(
 p_workspace_id uuid,p_limit integer DEFAULT 3
) RETURNS TABLE(action_id uuid,claim_token uuid,action_key text,opportunity_id uuid,
 recipient text,mailbox_id uuid,template_id uuid,purpose text,subject_template text,
 body_text_template text,contact_name text,company text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5
 THEN RAISE EXCEPTION 'EMAIL_CLAIM_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings settings ON settings.workspace_id=w.id
  JOIN public.automation_channel_ownership owner ON owner.workspace_id=w.id
  JOIN public.automation_email_provider_bindings binding ON binding.workspace_id=w.id
  WHERE w.id=p_workspace_id AND w.active AND settings.mode='live' AND NOT settings.emergency_stop
   AND owner.channel='email' AND owner.owner='new_engine'
   AND owner.legacy_dispatch_paused_at IS NOT NULL AND owner.release_approved_at IS NOT NULL
   AND owner.release_id IS NOT NULL AND binding.enabled)
 THEN RETURN; END IF;
 RETURN QUERY WITH ready AS(
  SELECT action.id,action.action_key,deal.id AS deal_id,
   lower(btrim(deal.data->>'email')) AS target,binding.mailbox_id,
   template.id AS registry_id,template.purpose,template.subject_template,
   template.body_text_template,left(coalesce(deal.data->>'contact',''),160) AS contact_name,
   left(coalesce(deal.data->>'company',''),160) AS company
  FROM public.automation_action_outbox action
  JOIN public.automation_executions execution ON execution.id=action.execution_id
   AND execution.workspace_id=action.workspace_id AND execution.state='running'
  JOIN public.automation_event_inbox inbox ON inbox.id=execution.inbox_id
   AND inbox.workspace_id=execution.workspace_id AND inbox.state='processed'
  JOIN public.automation_flow_versions version ON version.id=execution.flow_version_id
   AND version.workspace_id=execution.workspace_id AND version.status='published'
  JOIN public.automation_flows flow ON flow.id=version.flow_id
   AND flow.workspace_id=version.workspace_id AND flow.enabled
   AND flow.published_version_id=version.id
  JOIN public.crm_records deal ON deal.id=CASE WHEN (inbox.context_refs->>'opportunity_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (inbox.context_refs->>'opportunity_id')::uuid ELSE NULL END
   AND deal.kind='deal' AND NOT deal.deleted
  JOIN public.automation_email_provider_bindings binding
   ON binding.workspace_id=action.workspace_id AND binding.enabled
  JOIN public.automation_email_template_registry template
   ON template.workspace_id=action.workspace_id AND template.status='approved'
  JOIN public.automation_email_consents consent ON consent.workspace_id=action.workspace_id
   AND consent.opportunity_id=deal.id AND consent.purpose=template.purpose
   AND consent.revoked_at IS NULL
   AND consent.recipient_sha256=encode(sha256(convert_to(lower(btrim(deal.data->>'email')),'UTF8')),'hex')
  WHERE action.workspace_id=p_workspace_id AND action.action_type='email'
   AND action.state='queued' AND action.attempts<3
   AND (action.due_at IS NULL OR action.due_at<=clock_timestamp())
   AND length(lower(btrim(deal.data->>'email'))) BETWEEN 5 AND 254
   AND lower(btrim(deal.data->>'email')) ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+$'
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(version.graph_json->'nodes') graph_node
    WHERE graph_node->>'id'=action.node_id AND graph_node->>'type'='email'
     AND graph_node->'config'->>'template_id'=template.id::text
     AND graph_node->'config'->>'recipient_field' IN('lead.email','opportunity.email'))
  ORDER BY action.due_at NULLS FIRST,action.created_at,action.id
  LIMIT p_limit FOR UPDATE OF action SKIP LOCKED
 ), leased AS(
  UPDATE public.automation_action_outbox action SET state='leased',claim_token=gen_random_uuid(),
   attempts=action.attempts+1,claimed_at=clock_timestamp(),
   lease_until=clock_timestamp()+interval '90 seconds'
  FROM ready WHERE action.id=ready.id RETURNING action.id,action.claim_token,action.action_key
 ) SELECT leased.id,leased.claim_token,leased.action_key,ready.deal_id,ready.target,
  ready.mailbox_id,ready.registry_id,ready.purpose,ready.subject_template,
  ready.body_text_template,ready.contact_name,ready.company
 FROM leased JOIN ready ON ready.id=leased.id;
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_email_pre_send(
 p_workspace_id uuid,p_action_id uuid,p_claim_token uuid,p_opportunity_id uuid,
 p_recipient text,p_mailbox_id uuid,p_template_id uuid
) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $guard$
 SELECT EXISTS(SELECT 1 FROM public.automation_action_outbox action
  JOIN public.automation_executions execution ON execution.id=action.execution_id
   AND execution.workspace_id=action.workspace_id AND execution.state='running'
  JOIN public.automation_event_inbox inbox ON inbox.id=execution.inbox_id
   AND inbox.workspace_id=execution.workspace_id AND inbox.state='processed'
  JOIN public.automation_flow_versions version ON version.id=execution.flow_version_id
   AND version.workspace_id=execution.workspace_id AND version.status='published'
  JOIN public.automation_flows flow ON flow.id=version.flow_id
   AND flow.workspace_id=version.workspace_id AND flow.enabled AND flow.published_version_id=version.id
  JOIN public.automation_workspaces workspace ON workspace.id=action.workspace_id AND workspace.active
  JOIN public.automation_runtime_settings settings ON settings.workspace_id=workspace.id
   AND settings.mode='live' AND NOT settings.emergency_stop
  JOIN public.automation_channel_ownership owner ON owner.workspace_id=workspace.id
   AND owner.channel='email' AND owner.owner='new_engine'
   AND owner.legacy_dispatch_paused_at IS NOT NULL AND owner.release_approved_at IS NOT NULL
  JOIN public.automation_email_provider_bindings binding ON binding.workspace_id=workspace.id
   AND binding.enabled AND binding.mailbox_id=p_mailbox_id
  JOIN public.crm_records deal ON deal.id=p_opportunity_id AND deal.kind='deal' AND NOT deal.deleted
   AND lower(btrim(deal.data->>'email'))=lower(btrim(p_recipient))
  JOIN public.automation_email_template_registry template ON template.id=p_template_id
   AND template.workspace_id=workspace.id AND template.status='approved'
  JOIN public.automation_email_consents consent ON consent.workspace_id=workspace.id
   AND consent.opportunity_id=deal.id AND consent.purpose=template.purpose
   AND consent.revoked_at IS NULL
   AND consent.recipient_sha256=encode(sha256(convert_to(lower(btrim(p_recipient)),'UTF8')),'hex')
  WHERE action.workspace_id=p_workspace_id AND action.id=p_action_id
   AND action.action_type='email' AND action.state='leased'
   AND action.claim_token=p_claim_token AND action.lease_until>clock_timestamp()
   AND (inbox.context_refs->>'opportunity_id')=deal.id::text
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(version.graph_json->'nodes') graph_node
    WHERE graph_node->>'id'=action.node_id AND graph_node->>'type'='email'
     AND graph_node->'config'->>'template_id'=template.id::text));
$guard$;

CREATE OR REPLACE FUNCTION public.automation_whatsapp_claim_reply(
 p_workspace_id uuid,p_limit integer DEFAULT 3
) RETURNS TABLE(action_id uuid,claim_token uuid,action_key text,conversation_id uuid,
 phone_number_id text,text_ref text,body_text text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5
 THEN RAISE EXCEPTION 'WA_REPLY_CLAIM_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings settings ON settings.workspace_id=w.id
  JOIN public.automation_channel_ownership owner ON owner.workspace_id=w.id
  WHERE w.id=p_workspace_id AND w.active AND settings.mode='live' AND NOT settings.emergency_stop
   AND owner.channel='whatsapp' AND owner.owner='new_engine'
   AND owner.legacy_dispatch_paused_at IS NOT NULL AND owner.release_approved_at IS NOT NULL
   AND owner.release_id IS NOT NULL)
 THEN RETURN; END IF;
 RETURN QUERY WITH ready AS(
  SELECT action.id,action.action_key,conversation.id AS conversation_id,
   binding.phone_number_id,reply.text_ref,reply.body_text
  FROM public.automation_action_outbox action
  JOIN public.automation_executions execution ON execution.id=action.execution_id
   AND execution.workspace_id=action.workspace_id AND execution.state='running'
  JOIN public.automation_event_inbox inbox ON inbox.id=execution.inbox_id
   AND inbox.workspace_id=execution.workspace_id AND inbox.state='processed'
  JOIN public.automation_flow_versions version ON version.id=execution.flow_version_id
   AND version.workspace_id=execution.workspace_id AND version.status='published'
  JOIN public.automation_flows flow ON flow.id=version.flow_id
   AND flow.workspace_id=version.workspace_id AND flow.enabled AND flow.published_version_id=version.id
  JOIN public.crm_wa_conversations conversation ON conversation.id=CASE
   WHEN (inbox.context_refs->>'conversation_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   THEN (inbox.context_refs->>'conversation_id')::uuid ELSE NULL END
   AND conversation.mode='sdr_active' AND conversation.opted_out IS FALSE
   AND conversation.consent_granted IS TRUE
   AND conversation.last_inbound_at>clock_timestamp()-interval '23 hours 55 minutes'
  JOIN public.crm_wa_channels channel ON channel.id=conversation.channel_id AND channel.enabled
  JOIN public.automation_whatsapp_provider_bindings binding
   ON binding.workspace_id=action.workspace_id AND binding.crm_channel_id=channel.id
   AND binding.enabled AND binding.phone_number_id=channel.phone_number_id
  JOIN public.automation_sdr_reply_registry reply ON reply.workspace_id=action.workspace_id
   AND reply.status='approved'
  WHERE action.workspace_id=p_workspace_id AND action.action_type='whatsapp_reply'
   AND action.state='queued' AND action.attempts<3
   AND (action.due_at IS NULL OR action.due_at<=clock_timestamp())
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(version.graph_json->'nodes') graph_node
    WHERE graph_node->>'id'=action.node_id AND graph_node->>'type'='whatsapp_reply'
     AND graph_node->'config'->>'text_ref'=reply.text_ref)
  ORDER BY action.due_at NULLS FIRST,action.created_at,action.id
  LIMIT p_limit FOR UPDATE OF action SKIP LOCKED
 ), leased AS(
  UPDATE public.automation_action_outbox action SET state='leased',claim_token=gen_random_uuid(),
   attempts=action.attempts+1,claimed_at=clock_timestamp(),
   lease_until=clock_timestamp()+interval '90 seconds'
  FROM ready WHERE action.id=ready.id RETURNING action.id,action.claim_token,action.action_key
 ) SELECT leased.id,leased.claim_token,leased.action_key,ready.conversation_id,
  ready.phone_number_id,ready.text_ref,ready.body_text
 FROM leased JOIN ready ON ready.id=leased.id;
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_whatsapp_reply_pre_send(
 p_workspace_id uuid,p_action_id uuid,p_claim_token uuid,p_conversation_id uuid,
 p_phone_number_id text,p_text_ref text
) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $guard$
 SELECT EXISTS(SELECT 1 FROM public.automation_action_outbox action
  JOIN public.automation_executions execution ON execution.id=action.execution_id
   AND execution.workspace_id=action.workspace_id AND execution.state='running'
  JOIN public.automation_event_inbox inbox ON inbox.id=execution.inbox_id
   AND inbox.workspace_id=execution.workspace_id AND inbox.state='processed'
  JOIN public.automation_flow_versions version ON version.id=execution.flow_version_id
   AND version.workspace_id=execution.workspace_id AND version.status='published'
  JOIN public.automation_flows flow ON flow.id=version.flow_id
   AND flow.workspace_id=version.workspace_id AND flow.enabled AND flow.published_version_id=version.id
  JOIN public.automation_workspaces workspace ON workspace.id=action.workspace_id AND workspace.active
  JOIN public.automation_runtime_settings settings ON settings.workspace_id=workspace.id
   AND settings.mode='live' AND NOT settings.emergency_stop
  JOIN public.automation_channel_ownership owner ON owner.workspace_id=workspace.id
   AND owner.channel='whatsapp' AND owner.owner='new_engine'
   AND owner.legacy_dispatch_paused_at IS NOT NULL AND owner.release_approved_at IS NOT NULL
  JOIN public.crm_wa_conversations conversation ON conversation.id=p_conversation_id
   AND conversation.mode='sdr_active' AND conversation.opted_out IS FALSE
   AND conversation.consent_granted IS TRUE
   AND conversation.last_inbound_at>clock_timestamp()-interval '23 hours 55 minutes'
  JOIN public.crm_wa_channels channel ON channel.id=conversation.channel_id AND channel.enabled
  JOIN public.automation_whatsapp_provider_bindings binding
   ON binding.workspace_id=workspace.id AND binding.crm_channel_id=channel.id
   AND binding.enabled AND binding.phone_number_id=p_phone_number_id
  JOIN public.automation_sdr_reply_registry reply ON reply.workspace_id=workspace.id
   AND reply.text_ref=p_text_ref AND reply.status='approved'
  WHERE action.workspace_id=p_workspace_id AND action.id=p_action_id
   AND action.action_type='whatsapp_reply' AND action.state='leased'
   AND action.claim_token=p_claim_token AND action.lease_until>clock_timestamp()
   AND (inbox.context_refs->>'conversation_id')=conversation.id::text
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(version.graph_json->'nodes') graph_node
    WHERE graph_node->>'id'=action.node_id AND graph_node->>'type'='whatsapp_reply'
     AND graph_node->'config'->>'text_ref'=reply.text_ref));
$guard$;

CREATE OR REPLACE FUNCTION public.automation_meta_reply_receipt(
 p_workspace_id uuid,p_action_id uuid,p_claim_token uuid,
 p_provider_message_id text,p_rendered_body text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE action public.automation_action_outbox%ROWTYPE;conversation uuid;
BEGIN
 IF p_workspace_id IS NULL OR p_action_id IS NULL OR p_claim_token IS NULL
  OR p_provider_message_id IS NULL OR p_provider_message_id !~ '^[A-Za-z0-9_.:/=-]{3,512}$'
  OR length(p_rendered_body) NOT BETWEEN 1 AND 4096
 THEN RAISE EXCEPTION 'WA_REPLY_RECEIPT_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO action FROM public.automation_action_outbox
  WHERE workspace_id=p_workspace_id AND id=p_action_id FOR UPDATE;
 IF NOT FOUND OR action.action_type<>'whatsapp_reply'
  OR action.claim_token IS DISTINCT FROM p_claim_token
 THEN RAISE EXCEPTION 'WA_REPLY_RECEIPT_STALE' USING ERRCODE='42501'; END IF;
 IF action.state='sent' AND action.provider_result_id=p_provider_message_id
 THEN RETURN jsonb_build_object('ok',true,'alreadyRecorded',true,'dispatchAuthorized',false); END IF;
 IF action.state NOT IN('leased','uncertain')
 THEN RAISE EXCEPTION 'WA_REPLY_RECEIPT_STATE_INVALID' USING ERRCODE='42501'; END IF;
 SELECT (inbox.context_refs->>'conversation_id')::uuid INTO conversation
  FROM public.automation_executions execution
  JOIN public.automation_event_inbox inbox ON inbox.id=execution.inbox_id
  WHERE execution.id=action.execution_id
   AND (inbox.context_refs->>'conversation_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
 IF conversation IS NULL THEN RAISE EXCEPTION 'WA_REPLY_CONVERSATION_UNBOUND' USING ERRCODE='42501'; END IF;
 INSERT INTO public.crm_wa_messages(conversation_id,provider_message_id,direction,kind,body,occurred_at,delivery_status)
 VALUES(conversation,p_provider_message_id,'outbound','text',p_rendered_body,clock_timestamp(),'pending')
 ON CONFLICT(provider_message_id) DO NOTHING;
 UPDATE public.automation_action_outbox SET state='sent',provider_result_id=p_provider_message_id,
  result_code='META_PROVIDER_ACCEPTED',reconciled_at=clock_timestamp(),lease_until=NULL
 WHERE id=action.id AND claim_token=p_claim_token;
 RETURN jsonb_build_object('ok',true,'receiptStored',true,'dispatchAuthorized',false);
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_consent_status(
 p_workspace_id uuid,p_subject_id uuid
) RETURNS TABLE(channel text,purpose text,active boolean,granted_at timestamptz,revoked_at timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF p_workspace_id IS NULL OR p_subject_id IS NULL
 THEN RAISE EXCEPTION 'CONSENT_READ_DENIED' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT 'email'::text,consent.purpose,consent.revoked_at IS NULL,
  consent.granted_at,consent.revoked_at
 FROM public.automation_email_consents consent
 WHERE consent.workspace_id=p_workspace_id AND consent.opportunity_id=p_subject_id
 UNION ALL
 SELECT 'whatsapp'::text,consent.purpose,consent.revoked_at IS NULL,
  consent.granted_at,consent.revoked_at
 FROM public.automation_whatsapp_marketing_consents consent
 WHERE consent.workspace_id=p_workspace_id AND consent.conversation_id=p_subject_id
 ORDER BY 1,2;
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_consent_revoke(
 p_workspace_id uuid,p_channel text,p_subject_id uuid,p_purpose text,p_reason text,
 p_actor_id uuid
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE changed integer;
BEGIN
 IF p_workspace_id IS NULL OR p_subject_id IS NULL OR p_actor_id IS NULL
  OR p_channel NOT IN('email','whatsapp')
  OR length(btrim(coalesce(p_purpose,''))) NOT BETWEEN 3 AND 64
  OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 3 AND 160
  OR NOT EXISTS(SELECT 1 FROM public.automation_workspace_members member
   WHERE member.workspace_id=p_workspace_id AND member.user_id=p_actor_id
    AND member.role IN('publisher','admin'))
 THEN RAISE EXCEPTION 'CONSENT_REVOKE_DENIED' USING ERRCODE='42501'; END IF;
 IF p_channel='email' THEN
  UPDATE public.automation_email_consents SET revoked_at=coalesce(revoked_at,clock_timestamp()),
   revoke_reason=coalesce(revoke_reason,btrim(p_reason)),updated_at=clock_timestamp()
  WHERE workspace_id=p_workspace_id AND opportunity_id=p_subject_id
   AND purpose=p_purpose AND revoked_at IS NULL;
 ELSE
  UPDATE public.automation_whatsapp_marketing_consents
   SET revoked_at=coalesce(revoked_at,clock_timestamp())
  WHERE workspace_id=p_workspace_id AND conversation_id=p_subject_id
   AND purpose=p_purpose AND revoked_at IS NULL;
 END IF;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed>0 THEN
  INSERT INTO public.automation_consent_audit
   (workspace_id,channel,subject_id,purpose,action,actor_id)
  VALUES(p_workspace_id,p_channel,p_subject_id,p_purpose,'revoked',p_actor_id);
 END IF;
 RETURN changed>0;
END $fn$;

REVOKE ALL ON FUNCTION public.automation_live_wait_register(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_live_wait_cancel_reply(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_live_wait_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_live_wait_recover(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_live_wait_finish(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_live_engine_finish(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_live_crm_continue_wait(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_email_claim(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_email_pre_send(uuid,uuid,uuid,uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_whatsapp_claim_reply(uuid,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_whatsapp_reply_pre_send(uuid,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_meta_reply_receipt(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_consent_status(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_consent_revoke(uuid,text,uuid,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_live_wait_register(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_live_wait_cancel_reply(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_live_wait_claim(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_live_wait_recover(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_live_wait_finish(uuid,uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_live_engine_finish(uuid,uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_live_crm_continue_wait(uuid,uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_email_claim(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_email_pre_send(uuid,uuid,uuid,uuid,text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_whatsapp_claim_reply(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_whatsapp_reply_pre_send(uuid,uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_meta_reply_receipt(uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_consent_status(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_consent_revoke(uuid,text,uuid,text,text,uuid) TO service_role;

COMMIT;
