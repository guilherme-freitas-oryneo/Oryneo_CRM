-- Macro 3: CRM's existing single next_action adapter. Preview for isolated QA ONLY.
-- Never overwrites an open human task, never dispatches email/WhatsApp/Stripe.
-- The exact action text/offset come from an immutable published graph.
BEGIN;
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
 IF (n->'config') ? 'title' IS FALSE THEN
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
   to_char(clock_timestamp()+make_interval(mins=>v_offset),
     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'done',false);
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
