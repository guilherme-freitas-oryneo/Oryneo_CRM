-- ORYNEO outbound delivery protocol v1. PREPARATORY ONLY.
-- Never sends a message, charges a card, or changes a CRM stage.
-- The canonical live adapter does not yet exist; engine remains disabled.
BEGIN;
ALTER TABLE public.automation_action_outbox
 ADD COLUMN IF NOT EXISTS claim_token uuid,
 ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
 ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
CREATE INDEX IF NOT EXISTS automation_action_claim_ready_idx
 ON public.automation_action_outbox(workspace_id,due_at,id)
 WHERE state='queued';
CREATE INDEX IF NOT EXISTS automation_action_uncertain_idx
 ON public.automation_action_outbox(workspace_id,created_at,id)
 WHERE state='uncertain';
-- The same provider acknowledgement must not be attributed to two actions.
CREATE UNIQUE INDEX IF NOT EXISTS automation_provider_receipt_unique_idx
 ON public.automation_action_outbox(workspace_id,provider_result_id)
 WHERE state='sent' AND provider_result_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.automation_delivery_claim(
 p_workspace_id uuid,p_limit integer DEFAULT 5)
RETURNS TABLE(action_id uuid,claim_token uuid,action_key text,
 action_type text,attempt integer,lease_deadline timestamptz)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10
 THEN RAISE EXCEPTION 'DELIVERY_CLAIM_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
    WHERE w.id=p_workspace_id AND w.active AND s.mode='live' AND NOT s.emergency_stop)
 THEN RETURN; END IF;
 RETURN QUERY
 WITH available AS (
   SELECT a.id FROM public.automation_action_outbox a
   JOIN public.automation_executions e ON e.id=a.execution_id
     AND e.workspace_id=a.workspace_id AND e.state='running'
   JOIN public.automation_flow_versions v ON v.id=e.flow_version_id
     AND v.workspace_id=e.workspace_id AND v.status='published'
   JOIN public.automation_flows f ON f.id=v.flow_id
     AND f.workspace_id=v.workspace_id AND f.enabled
     AND f.published_version_id=v.id
   JOIN public.automation_channel_ownership own
     ON own.workspace_id=a.workspace_id AND own.owner='new_engine'
     AND own.legacy_dispatch_paused_at IS NOT NULL
     AND own.release_approved_at IS NOT NULL
     AND own.release_id IS NOT NULL
     AND own.channel=CASE
       WHEN a.action_type IN('whatsapp_template','whatsapp_reply','human_handoff')
         THEN 'whatsapp'
       WHEN a.action_type='email' THEN 'email'
       WHEN a.action_type IN('crm_stage_change','crm_update','crm_task','notify')
         THEN 'crm'
       ELSE 'unsupported' END
   WHERE a.workspace_id=p_workspace_id AND a.state='queued'
     AND (a.due_at IS NULL OR a.due_at<=clock_timestamp())
     AND a.attempts<3
     AND jsonb_typeof(v.graph_json->'nodes')='array'
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n
       WHERE n->>'id'=a.node_id AND n->>'type'=a.action_type)
   ORDER BY a.due_at NULLS FIRST,a.created_at,a.id LIMIT p_limit
   FOR UPDATE OF a SKIP LOCKED
 ), reserved AS (
   UPDATE public.automation_action_outbox a SET
     state='leased',claim_token=gen_random_uuid(),
     attempts=a.attempts+1,claimed_at=clock_timestamp(),
     lease_until=clock_timestamp()+interval '90 seconds'
   FROM available r WHERE a.id=r.id
   RETURNING a.id,a.claim_token,a.action_key,a.action_type,a.attempts,a.lease_until
 )
 SELECT r.id,r.claim_token,r.action_key,r.action_type,r.attempts,r.lease_until
 FROM reserved r;
END; $$;

-- Claim token is a fencing token: an older worker cannot acknowledge a newer
-- lease or claim success without an actual provider receipt identifier.
CREATE OR REPLACE FUNCTION public.automation_delivery_finish(
 p_workspace_id uuid,p_action_id uuid,p_claim_token uuid,
 p_state text,p_provider_result_id text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v public.automation_action_outbox%ROWTYPE;
BEGIN
 IF p_workspace_id IS NULL OR p_action_id IS NULL OR p_claim_token IS NULL
   OR p_state NOT IN ('sent','uncertain','failed')
 THEN RAISE EXCEPTION 'DELIVERY_FINISH_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF p_state='sent' AND
   (p_provider_result_id IS NULL OR length(p_provider_result_id) NOT BETWEEN 3 AND 512
    OR p_provider_result_id !~ '^[A-Za-z0-9_.:/=-]+$')
 THEN RAISE EXCEPTION 'PROVIDER_RECEIPT_REQUIRED' USING ERRCODE='22023'; END IF;
 IF p_state<>'sent' AND p_provider_result_id IS NOT NULL
 THEN RAISE EXCEPTION 'AMBIGUOUS_RECEIPT_STATE' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.automation_action_outbox
 WHERE workspace_id=p_workspace_id AND id=p_action_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DELIVERY_ACTION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF v.state='sent' AND p_state='sent'
   AND v.provider_result_id=p_provider_result_id
   AND v.claim_token=p_claim_token THEN RETURN 'sent'; END IF;
 IF v.state<>'leased' OR v.claim_token IS DISTINCT FROM p_claim_token
 THEN RAISE EXCEPTION 'DELIVERY_LEASE_FENCE_CONFLICT' USING ERRCODE='40001'; END IF;
 -- A late sent receipt can reconcile a lease that just expired, but NEVER
 -- a lease whose token was replaced by another process.
 UPDATE public.automation_action_outbox SET
   state=p_state,provider_result_id=CASE WHEN p_state='sent' THEN p_provider_result_id ELSE NULL END,
   result_code=CASE p_state WHEN 'sent' THEN 'PROVIDER_ACKED'
      WHEN 'uncertain' THEN 'PROVIDER_OUTCOME_UNKNOWN' ELSE 'DEFINITIVE_NON_SEND' END,
   reconciled_at=CASE WHEN p_state='sent' THEN clock_timestamp() ELSE NULL END,
   lease_until=NULL WHERE id=v.id AND claim_token=p_claim_token;
 RETURN p_state;
END; $$;

-- Timeout is AMBIGUOUS: do not retry a potentially delivered WhatsApp/e-mail.
CREATE OR REPLACE FUNCTION public.automation_delivery_expire_uncertain(
 p_workspace_id uuid,p_limit integer DEFAULT 20)
RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_count integer;
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
 THEN RAISE EXCEPTION 'DELIVERY_EXPIRY_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 WITH expired AS (
  SELECT a.id FROM public.automation_action_outbox a
  WHERE a.workspace_id=p_workspace_id AND a.state='leased'
    AND a.lease_until < clock_timestamp()
  ORDER BY a.lease_until,a.id LIMIT p_limit FOR UPDATE SKIP LOCKED
 ), changed AS (
  UPDATE public.automation_action_outbox a SET
    state='uncertain',result_code='LEASE_EXPIRED_OUTCOME_UNKNOWN',
    lease_until=NULL
  FROM expired e WHERE a.id=e.id RETURNING a.id
 )
 SELECT count(*) INTO v_count FROM changed;
 RETURN v_count;
END; $$;

-- Reconciliation is receipt-based only: there is no uncertain->queued retry.
CREATE OR REPLACE FUNCTION public.automation_delivery_reconcile_receipt(
 p_workspace_id uuid,p_action_id uuid,p_claim_token uuid,p_provider_result_id text)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v public.automation_action_outbox%ROWTYPE;
BEGIN
 IF p_workspace_id IS NULL OR p_action_id IS NULL OR p_claim_token IS NULL
   OR p_provider_result_id IS NULL
   OR length(p_provider_result_id) NOT BETWEEN 3 AND 512
   OR p_provider_result_id !~ '^[A-Za-z0-9_.:/=-]+$'
 THEN RAISE EXCEPTION 'RECONCILIATION_PROOF_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO v FROM public.automation_action_outbox
 WHERE workspace_id=p_workspace_id AND id=p_action_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DELIVERY_ACTION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
 IF v.claim_token IS DISTINCT FROM p_claim_token
 THEN RAISE EXCEPTION 'DELIVERY_LEASE_FENCE_CONFLICT' USING ERRCODE='40001'; END IF;
 IF v.state='sent' AND v.provider_result_id=p_provider_result_id THEN RETURN 'sent'; END IF;
 IF v.state NOT IN ('uncertain','leased')
 THEN RAISE EXCEPTION 'DELIVERY_STATE_NOT_RECONCILABLE' USING ERRCODE='40001'; END IF;
 UPDATE public.automation_action_outbox
 SET state='sent',provider_result_id=p_provider_result_id,
     result_code='RECONCILED_PROVIDER_ACK',
     reconciled_at=clock_timestamp(),lease_until=NULL
 WHERE id=v.id;
 RETURN 'sent';
END; $$;

REVOKE ALL ON FUNCTION public.automation_delivery_claim(uuid,integer)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_delivery_finish(uuid,uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_delivery_expire_uncertain(uuid,integer)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_delivery_reconcile_receipt(uuid,uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_delivery_claim(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_delivery_finish(uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_delivery_expire_uncertain(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_delivery_reconcile_receipt(uuid,uuid,uuid,text) TO service_role;
COMMIT;
