-- Isolated DB QA for canonical stop guards. Existing fixture creates waits.
\set ON_ERROR_STOP on
CREATE TABLE public.crm_wa_conversations(
 id uuid PRIMARY KEY,
 mode text,
 opted_out boolean,
 consent_granted boolean
);
GRANT SELECT,INSERT,UPDATE ON public.crm_wa_conversations TO service_role;
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 flow_version uuid;inbox uuid;exe uuid;current_id uuid;v_changed integer;
 convo_ok uuid:='6a000000-0000-4000-8000-000000000001';
 convo_human uuid:='6a000000-0000-4000-8000-000000000002';
 convo_optout uuid:='6a000000-0000-4000-8000-000000000003';
 convo_no_consent uuid:='6a000000-0000-4000-8000-000000000004';
 convo_missing uuid:='6a000000-0000-4000-8000-000000000005';
 due timestamptz:=clock_timestamp()+interval '1 hour';
BEGIN
 SELECT id INTO flow_version FROM public.automation_flow_versions
  WHERE workspace_id=w AND status='published' ORDER BY version DESC LIMIT 1;
 IF flow_version IS NULL THEN RAISE EXCEPTION 'Missing published QA fixture'; END IF;
 INSERT INTO public.automation_event_inbox(workspace_id,source,event_id,event_type,schema_version)
 VALUES(w,'crm','qa.reconcile.policy.1','opportunity.created','1.0.0') RETURNING id INTO inbox;
 INSERT INTO public.automation_executions(workspace_id,flow_version_id,inbox_id,state)
 VALUES(w,flow_version,inbox,'shadow') RETURNING id INTO exe;
 INSERT INTO public.crm_wa_conversations(id,mode,opted_out,consent_granted)
 VALUES
 (convo_ok,'sdr_active',false,true),
 (convo_human,'human_locked',false,true),
 (convo_optout,'sdr_active',true,true),
 (convo_no_consent,'review',false,false);
 UPDATE public.automation_workspaces SET active=true WHERE id=w;
 UPDATE public.automation_runtime_settings SET mode='shadow',emergency_stop=false WHERE workspace_id=w;
 PERFORM public.automation_wait_shadow_register(w,exe,'6b000000-0000-4000-8000-000000000001',due,true,convo_ok);
 PERFORM public.automation_wait_shadow_register(w,exe,'6b000000-0000-4000-8000-000000000002',due,true,convo_human);
 PERFORM public.automation_wait_shadow_register(w,exe,'6b000000-0000-4000-8000-000000000003',due,true,convo_optout);
 PERFORM public.automation_wait_shadow_register(w,exe,'6b000000-0000-4000-8000-000000000004',due,true,convo_no_consent);
 PERFORM public.automation_wait_shadow_register(w,exe,'6b000000-0000-4000-8000-000000000005',due,true,convo_missing);
 v_changed:=public.automation_wait_shadow_reconcile_policy(w,50);
 IF v_changed<>4 THEN RAISE EXCEPTION 'Expected 4 unsafe waits cancelled, got %',v_changed; END IF;
 IF (SELECT count(*) FROM public.automation_wait_timers WHERE workspace_id=w
   AND state='waiting')<>1 THEN RAISE EXCEPTION 'Eligible SDR wait was incorrectly cancelled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_wait_timers
   WHERE conversation_id=convo_human AND reason_code='HUMAN_OR_REVIEW_MODE')
 OR NOT EXISTS(SELECT 1 FROM public.automation_wait_timers
   WHERE conversation_id=convo_optout AND reason_code='OPTED_OUT')
 OR NOT EXISTS(SELECT 1 FROM public.automation_wait_timers
   WHERE conversation_id=convo_no_consent AND reason_code='CONSENT_NOT_VERIFIED')
 OR NOT EXISTS(SELECT 1 FROM public.automation_wait_timers
   WHERE conversation_id=convo_missing AND reason_code='CONVERSATION_NOT_FOUND')
 THEN RAISE EXCEPTION 'Policy stop codes are not canonical'; END IF;
 IF public.automation_wait_shadow_reconcile_policy(w,50)<>0
 THEN RAISE EXCEPTION 'Idempotent reconciliation returned duplicate cancellation'; END IF;
 UPDATE public.crm_wa_conversations SET mode='human_locked' WHERE id=convo_ok;
 IF public.automation_wait_shadow_reconcile_policy(w,50)<>1
 THEN RAISE EXCEPTION 'Human takeover did not cancel pending follow-up'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_wait_timers
    WHERE workspace_id=w AND state='waiting')
 THEN RAISE EXCEPTION 'Pending automated follow-up remains after handoff'; END IF;
 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
 IF public.automation_wait_shadow_reconcile_policy(w,50)<>0
 THEN RAISE EXCEPTION 'Emergency stop allowed reconciliation to proceed'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE state<>'blocked')
 THEN RAISE EXCEPTION 'Shadow stop policy emitted an action'; END IF;
END; $qa$;
RESET ROLE;
DO $permissions$
BEGIN
 IF has_function_privilege('anon',
  'public.automation_wait_shadow_reconcile_policy(uuid,integer)','EXECUTE')
  OR has_function_privilege('authenticated',
  'public.automation_wait_shadow_reconcile_policy(uuid,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'Untrusted users can reconcile shadow waits'; END IF;
END; $permissions$;
SELECT 'shadow-wait-stop-reconcile-qa-passed' AS qa_result;
