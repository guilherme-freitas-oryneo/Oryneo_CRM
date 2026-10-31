-- ORYNEO Macro 3: PREVIEW ONLY, no release or hosted application.
-- Atomic, version-fenced CRM stage adapter. The effective target stage is
-- read from the immutable published graph, NOT worker/browser input.
-- The existing CRM stage IDs and history are retained. No Stripe/Meta/email.
BEGIN;
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
      VALUES(NULL,v_deal.id,v_deal.data,v_deal.deleted,v_deal.revision+1);
   INSERT INTO public.crm_events(deal_id,event_type,actor,actor_label,detail)
      VALUES(v_deal.id,'stage_changed',NULL,'ORYNEO Automações',
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
COMMIT;
