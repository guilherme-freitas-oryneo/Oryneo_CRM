-- Stage 3 CRM next-action acceptance. Only disposable PostgreSQL 17.
\set ON_ERROR_STOP on
\i supabase/automation/commercial_crm_task_adapter.preview.sql
BEGIN;
UPDATE public.automation_workspaces SET active=true
 WHERE id='11111111-1111-4111-8111-111111111111';
UPDATE public.automation_runtime_settings SET mode='live',emergency_stop=false
 WHERE workspace_id='11111111-1111-4111-8111-111111111111';
-- This temporary owner attestation never leaves the disposable test transaction.
UPDATE public.automation_channel_ownership
 SET owner='new_engine',release_approved_at=clock_timestamp(),
 legacy_dispatch_paused_at=clock_timestamp()-interval '2 minutes',
 release_id='qa-crm-task-exclusive'
 WHERE workspace_id='11111111-1111-4111-8111-111111111111'
   AND channel='crm';
INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
 VALUES('da000000-0000-4000-8000-000000000001',
 '11111111-1111-4111-8111-111111111111','qa-crm-next-action',
 'QA next_action','pipeline',false);
INSERT INTO public.automation_flow_versions(
 id,workspace_id,flow_id,version,schema_version,graph_json,
 content_sha256,status,published_by,published_at)
 VALUES('da000000-0000-4000-8000-000000000002',
 '11111111-1111-4111-8111-111111111111',
 'da000000-0000-4000-8000-000000000001',1,'1.0.0',
 '{"nodes":[{"id":"da000000-0000-4000-8000-000000000006",
 "type":"crm_task","config":{"title":"Agendar diagnóstico",
 "due_offset_minutes":45}}],"edges":[]}'::jsonb,
 repeat('c',64),'published','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 clock_timestamp());
UPDATE public.automation_flows SET enabled=true,
 published_version_id='da000000-0000-4000-8000-000000000002'
 WHERE id='da000000-0000-4000-8000-000000000001';
INSERT INTO public.automation_event_inbox(
 id,workspace_id,source,event_id,event_type,schema_version,context_refs)
 VALUES('da000000-0000-4000-8000-000000000003',
 '11111111-1111-4111-8111-111111111111','crm',
 'qa.crm.task.canonical','opportunity.created','1.0.0',
 '{"opportunity_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01"}');
INSERT INTO public.automation_executions(
 id,workspace_id,flow_version_id,inbox_id,state)
 VALUES('da000000-0000-4000-8000-000000000004',
 '11111111-1111-4111-8111-111111111111',
 'da000000-0000-4000-8000-000000000002',
 'da000000-0000-4000-8000-000000000003','running');
INSERT INTO public.automation_action_outbox(
 id,workspace_id,execution_id,node_id,action_key,action_type,state,due_at)
 VALUES('da000000-0000-4000-8000-000000000005',
 '11111111-1111-4111-8111-111111111111',
 'da000000-0000-4000-8000-000000000004',
 'da000000-0000-4000-8000-000000000006',repeat('d',64),
 'crm_task','queued',clock_timestamp()-interval '1 second');
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 a uuid:='da000000-0000-4000-8000-000000000005';
 token uuid;
 old_rev bigint;
 old_history integer;
 old_events integer;
 r jsonb;
 due_at timestamptz;
 denied boolean;
BEGIN
 SELECT revision INTO old_rev FROM public.crm_records
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
 SELECT count(*) INTO old_history FROM public.crm_history;
 SELECT count(*) INTO old_events FROM public.crm_events;
 SELECT claim_token INTO token FROM public.automation_delivery_claim(w,1)
  WHERE action_id=a;
 IF token IS NULL THEN RAISE EXCEPTION 'Next-action was not leased'; END IF;
 denied:=false;
 BEGIN
  PERFORM public.automation_crm_task_action(w,a,token,old_rev+1);
 EXCEPTION WHEN serialization_failure THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Invalid expected revision allowed CRM activity'; END IF;
 r:=public.automation_crm_task_action(w,a,token,old_rev);
 IF r->>'outcome'<>'task_created' THEN
  RAISE EXCEPTION 'Next-action not created: %',r; END IF;
 IF (SELECT data->'next_action'->>'title' FROM public.crm_records
  WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01')<>'Agendar diagnóstico'
 THEN RAISE EXCEPTION 'Canonical task was not saved'; END IF;
 SELECT (data->'next_action'->>'due_at')::timestamptz INTO due_at
 FROM public.crm_records
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
 IF due_at IS NULL OR due_at NOT BETWEEN clock_timestamp()+interval '43 minutes'
  AND clock_timestamp()+interval '47 minutes'
 THEN RAISE EXCEPTION 'Task due date is not the configured offset'; END IF;
 IF (SELECT count(*) FROM public.crm_history)<>old_history+1 OR
 (SELECT count(*) FROM public.crm_events)<>old_events+1
 THEN RAISE EXCEPTION 'Activity was not audited once'; END IF;
 r:=public.automation_crm_task_action(w,a,token,old_rev);
 IF r->>'outcome'<>'duplicate_noop'
 THEN RAISE EXCEPTION 'Duplicate delivery mutated activity'; END IF;
 IF (SELECT count(*) FROM public.crm_history)<>old_history+1 OR
 (SELECT count(*) FROM public.crm_events)<>old_events+1
 THEN RAISE EXCEPTION 'Activity duplicated history'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_history h
  WHERE h.record_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'
    AND h.actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    AND h.after_revision=old_rev+1)
 THEN RAISE EXCEPTION 'Activity actor missing from canonical history'; END IF;
 -- A second new action MUST NOT overwrite an unfinished human next_action.
 UPDATE public.automation_action_outbox SET state='queued',claim_token=NULL,
  lease_until=NULL,provider_result_id=NULL
 WHERE id=a;
 SELECT claim_token INTO token FROM public.automation_delivery_claim(w,1)
  WHERE action_id=a;
 IF token IS NULL THEN RAISE EXCEPTION 'Second test lease missing'; END IF;
 denied:=false;
 BEGIN
  PERFORM public.automation_crm_task_action(w,a,token,old_rev+1);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Existing unfinished task was overwritten'; END IF;
END $qa$;
RESET ROLE;
ROLLBACK;
DO $security$
BEGIN
 IF has_function_privilege('authenticated',
  'public.automation_crm_task_action(uuid,uuid,uuid,bigint)','EXECUTE')
 OR has_function_privilege('anon',
  'public.automation_crm_task_action(uuid,uuid,uuid,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'Task action exposed to browser clients'; END IF;
END $security$;
SELECT 'stage3-crm-next-action-safe-idempotent-qa-passed' AS qa_result;
