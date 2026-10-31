-- Macro 6: disposable DB proof of action->action->end continuation.
\set ON_ERROR_STOP on
\i supabase/automation/live_crm_continue.preview.sql
DO $security$
BEGIN
 IF has_table_privilege('anon','public.automation_live_crm_continuations','SELECT')
 OR has_function_privilege('authenticated',
  'public.automation_live_crm_continue(uuid,uuid,uuid,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'LIVE_CONTINUATIONS_PUBLICLY_ACCESSIBLE'; END IF;
END $security$;
BEGIN;
UPDATE public.automation_workspaces SET active=true WHERE
 id='11111111-1111-4111-8111-111111111111';
UPDATE public.automation_runtime_settings SET mode='live',emergency_stop=false
 WHERE workspace_id='11111111-1111-4111-8111-111111111111';
UPDATE public.automation_channel_ownership SET
 owner='new_engine',legacy_dispatch_paused_at=clock_timestamp()-interval '2 minutes',
 release_approved_at=clock_timestamp(),release_id='qa-macro6-continuation'
 WHERE workspace_id='11111111-1111-4111-8111-111111111111' AND channel='crm';
INSERT INTO public.automation_flows
 (id,workspace_id,slug,name,kind,enabled)
 VALUES('c8000000-0000-4000-8000-000000000001',
 '11111111-1111-4111-8111-111111111111','qa-crm-continuation',
 'QA CRM two actions','pipeline',false);
INSERT INTO public.automation_flow_versions
 (id,workspace_id,flow_id,version,schema_version,graph_json,status,
 content_sha256,published_by,published_at)
 VALUES('c8000000-0000-4000-8000-000000000002',
 '11111111-1111-4111-8111-111111111111',
 'c8000000-0000-4000-8000-000000000001',1,'1.0.0',
 '{"nodes":[
 {"id":"c8000000-0000-4000-8000-000000000006","type":"trigger","config":{"event_type":"opportunity.created"}},
 {"id":"c8000000-0000-4000-8000-000000000007","type":"crm_task","config":{"title":"A","due_offset_minutes":1}},
 {"id":"c8000000-0000-4000-8000-000000000008","type":"crm_task","config":{"title":"B","due_offset_minutes":1}},
 {"id":"c8000000-0000-4000-8000-000000000009","type":"end","config":{}}],
 "edges":[
 {"source":"c8000000-0000-4000-8000-000000000007","source_port":"out","target":"c8000000-0000-4000-8000-000000000008"},
 {"source":"c8000000-0000-4000-8000-000000000008","source_port":"out","target":"c8000000-0000-4000-8000-000000000009"}]}'::jsonb,
 'published',repeat('c',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp());
UPDATE public.automation_flows SET
 published_version_id='c8000000-0000-4000-8000-000000000002',enabled=true
 WHERE id='c8000000-0000-4000-8000-000000000001';
INSERT INTO public.automation_event_inbox
 (id,workspace_id,source,event_id,event_type,schema_version,context_refs,state)
 VALUES('c8000000-0000-4000-8000-000000000003',
 '11111111-1111-4111-8111-111111111111',
 'crm','crm:c8000000-0000-4000-8000-000000000005',
 'opportunity.created','1.0.0',
 '{"opportunity_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01"}','processed');
INSERT INTO public.automation_executions
 (id,workspace_id,flow_version_id,inbox_id,state)
 VALUES('c8000000-0000-4000-8000-000000000004',
 '11111111-1111-4111-8111-111111111111',
 'c8000000-0000-4000-8000-000000000002',
 'c8000000-0000-4000-8000-000000000003','running');
INSERT INTO public.automation_action_outbox
 (id,workspace_id,execution_id,node_id,action_key,action_type,state,provider_result_id)
 VALUES('c8000000-0000-4000-8000-000000000010',
 '11111111-1111-4111-8111-111111111111',
 'c8000000-0000-4000-8000-000000000004',
 'c8000000-0000-4000-8000-000000000007',repeat('a',64),
 'crm_task','sent','crm:'||repeat('a',64));
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 exec uuid:='c8000000-0000-4000-8000-000000000004';
 previous uuid:='c8000000-0000-4000-8000-000000000010';
 version uuid:='c8000000-0000-4000-8000-000000000002';
 nextNode text:='c8000000-0000-4000-8000-000000000008';
 nextEnd text:='c8000000-0000-4000-8000-000000000009';
 activation text;actionkey text;
 decision jsonb;finished jsonb;result jsonb;denied boolean:=false;
BEGIN
 activation:=encode(sha256(convert_to(array_to_json(
 ARRAY[w::text,version::text,'crm','crm:c8000000-0000-4000-8000-000000000005'])::text,'UTF8')),'hex');
 actionkey:=encode(sha256(convert_to(
  array_to_json(ARRAY[activation,nextNode,'crm_task'])::text,'UTF8')),'hex');
 decision:=jsonb_build_object('dispatchAuthorized',false,'activationKey',activation,
  'state','awaiting_server_outcome',
  'trace',jsonb_build_array(jsonb_build_object('nodeId',nextNode,
   'type','crm_task','status','requires_server_result')),
  'plannedActions',jsonb_build_array(jsonb_build_object(
   'nodeId',nextNode,'type','crm_task','actionKey',actionkey)));
 denied:=false;
 BEGIN
  PERFORM public.automation_live_crm_continue(w,exec,previous,
    jsonb_set(decision,'{plannedActions,0,actionKey}',to_jsonb(repeat('f',64))));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'FORGED_CONTINUATION_ACCEPTED'; END IF;
 result:=public.automation_live_crm_continue(w,exec,previous,decision);
 IF result->>'continued'<>'true' OR result->>'dispatchAuthorized'<>'false'
 THEN RAISE EXCEPTION 'CONTINUATION_COMMIT_FAILED: %',result; END IF;
 IF (SELECT count(*) FROM public.automation_action_outbox
   WHERE workspace_id=w AND execution_id=exec AND state='queued'
    AND action_key=actionkey)<>1
 THEN RAISE EXCEPTION 'SECOND_ACTION_NOT_QUEUED_EXACTLY_ONCE'; END IF;
 result:=public.automation_live_crm_continue(w,exec,previous,decision);
 IF result->>'alreadyContinued'<>'true' THEN RAISE EXCEPTION 'DUPLICATED_CONTINUATION'; END IF;
 IF (SELECT count(*) FROM public.automation_action_outbox
   WHERE workspace_id=w AND execution_id=exec AND action_key=actionkey)<>1
 THEN RAISE EXCEPTION 'CONTINUATION_OUTBOX_DUPLICATED'; END IF;
 UPDATE public.automation_action_outbox SET
 state='sent',provider_result_id='crm:'||actionkey
 WHERE workspace_id=w AND execution_id=exec AND action_key=actionkey;
 finished:=jsonb_build_object('dispatchAuthorized',false,'activationKey',activation,
  'state','completed','trace',jsonb_build_array(jsonb_build_object(
   'nodeId',nextEnd,'type','end','status','completed')),
  'plannedActions','[]'::jsonb);
 result:=public.automation_live_crm_continue(w,exec,
  (SELECT id FROM public.automation_action_outbox WHERE execution_id=exec AND action_key=actionkey),
  finished);
 IF result->>'complete'<>'true' OR
  (SELECT state FROM public.automation_executions WHERE id=exec)<>'completed'
 THEN RAISE EXCEPTION 'TERMINAL_GRAPH_NOT_FINISHED'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox
  WHERE execution_id=exec AND action_type NOT IN('crm_task','crm_stage_change'))
 THEN RAISE EXCEPTION 'EXTERNAL_TRANSPORT_ESCAPED_CRM_FENCE'; END IF;
END $qa$;
RESET ROLE;
ROLLBACK;
SELECT 'macro6-crm-action-continuation-once-qa-passed' AS qa_result;
