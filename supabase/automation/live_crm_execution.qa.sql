-- Macro 6 disposable PostgreSQL 17 live CRM pipeline QA, no provider effects.
\set ON_ERROR_STOP on
\i supabase/automation/live_crm_execution.preview.sql
\i supabase/automation/live_crm_cursor.preview.sql
DO $acl$
BEGIN
 IF has_function_privilege('anon','public.automation_live_crm_ingest(uuid,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.automation_live_crm_claim(uuid,integer)','EXECUTE')
 OR has_function_privilege('authenticated','public.automation_live_crm_finish(uuid,uuid,uuid,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'LIVE_CRM_RPC_EXPOSED_TO_CLIENT'; END IF;
END $acl$;
BEGIN;
INSERT INTO public.crm_events(id,deal_id,event_type,created_at)
 VALUES('c6000000-0000-4000-8000-000000000001',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','received',clock_timestamp());
-- Choose the existing canonical ORYNEO QA workspace, not the second synthetic one.
UPDATE public.automation_workspaces SET active=false
 WHERE id='11111111-1111-4111-8111-111111111111';
UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true
 WHERE workspace_id='11111111-1111-4111-8111-111111111111';
INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
 VALUES('c6000000-0000-4000-8000-000000000002',
 '11111111-1111-4111-8111-111111111111',
 'qa-macro6-live-crm','Macro 6 test','pipeline',false);
INSERT INTO public.automation_flow_versions(
 id,workspace_id,flow_id,version,schema_version,graph_json,
 content_sha256,status,published_by,published_at)
 VALUES('c6000000-0000-4000-8000-000000000003',
 '11111111-1111-4111-8111-111111111111',
 'c6000000-0000-4000-8000-000000000002',1,'1.0.0',
 '{"nodes":[{"id":"c6000000-0000-4000-8000-000000000004","type":"trigger",
  "config":{"event_type":"opportunity.created"}},
 {"id":"c6000000-0000-4000-8000-000000000005","type":"crm_task",
  "config":{"title":"Agendar diagnóstico","delay_minutes":15}}],
 "edges":[{"source":"c6000000-0000-4000-8000-000000000004",
 "source_port":"out","target":"c6000000-0000-4000-8000-000000000005"}]}'::jsonb,
 repeat('a',64),'published','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp());
UPDATE public.automation_flows SET
 enabled=true,published_version_id='c6000000-0000-4000-8000-000000000003'
 WHERE id='c6000000-0000-4000-8000-000000000002';
SET ROLE service_role;
DO $qa$
DECLARE w uuid:='11111111-1111-4111-8111-111111111111';
 ev uuid:='c6000000-0000-4000-8000-000000000001';
 version uuid:='c6000000-0000-4000-8000-000000000003';
 node text:='c6000000-0000-4000-8000-000000000005';
 inbox uuid; token uuid; activation text; actionkey text;
 decision jsonb; plan jsonb; result jsonb; bootstrap timestamptz;
 refused boolean:=false;
BEGIN
 BEGIN
  PERFORM public.automation_live_crm_ingest(w,ev);
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'DISABLED_RUNTIME_INGESTED_LIVE'; END IF;
 bootstrap:=public.automation_live_crm_init_cursor(w,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
 IF bootstrap IS NULL OR bootstrap IS DISTINCT FROM
    public.automation_live_crm_init_cursor(w,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
 THEN RAISE EXCEPTION 'LIVE_CRM_CURSOR_BOOTSTRAP_NOT_IDEMPOTENT'; END IF;
 UPDATE public.automation_workspaces SET active=true WHERE id=w;
 UPDATE public.automation_runtime_settings SET mode='live',emergency_stop=false WHERE workspace_id=w;
 UPDATE public.automation_channel_ownership SET
   owner='new_engine',legacy_dispatch_paused_at=clock_timestamp()-interval '2 minutes',
   release_approved_at=clock_timestamp(),release_id='qa-macro6-crm-only'
 WHERE workspace_id=w AND channel='crm';
 INSERT INTO public.crm_events(id,deal_id,event_type,created_at)
 VALUES('c6000000-0000-4000-8000-000000000006',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01','stage_changed',clock_timestamp());
 result:=public.automation_live_crm_poll(w,20);
 IF result->>'scanned'<>'1' OR result->>'dispatchAuthorized'<>'false'
 OR (public.automation_live_crm_poll(w,20)->>'scanned')<>'0'
 THEN RAISE EXCEPTION 'CANONICAL_CRM_CURSOR_REPLAY_OR_LOSS: %',result; END IF;
 -- The disposable schema already contains pending shadow fixtures. They are
 -- unrelated to this canonical CRM claim and must not consume its batch slot.
 UPDATE public.automation_event_inbox SET state='ignored'
  WHERE workspace_id=w AND state='pending' AND source='crm'
   AND event_id IS DISTINCT FROM 'crm:'||ev::text;
 inbox:=public.automation_live_crm_ingest(w,ev);
 IF inbox IS NULL OR public.automation_live_crm_ingest(w,ev)<>inbox
 THEN RAISE EXCEPTION 'LIVE_CRM_REPLAY_NOT_DEDUPED'; END IF;
 SELECT lease_token INTO token FROM public.automation_live_crm_claim(w,1)
 WHERE inbox_id=inbox;
 IF token IS NULL THEN RAISE EXCEPTION 'LIVE_CRM_EVENT_NOT_LEASED'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_live_crm_claim(w,1) WHERE inbox_id=inbox)
 THEN RAISE EXCEPTION 'LIVE_CRM_DOUBLE_LEASE'; END IF;
 activation:=encode(sha256(convert_to(
  array_to_json(ARRAY[w::text,version::text,'crm','crm:'||ev::text])::text,'UTF8')),'hex');
 actionkey:=encode(sha256(convert_to(
  array_to_json(ARRAY[activation,node,'crm_task'])::text,'UTF8')),'hex');
 decision:=jsonb_build_object('dispatchAuthorized',false,'state','awaiting_server_outcome',
  'activationKey',activation,'trace',jsonb_build_array(
   jsonb_build_object('nodeId','c6000000-0000-4000-8000-000000000004',
    'type','trigger','status','evaluated','nextPort','out'),
   jsonb_build_object('nodeId',node,'type','crm_task','status','requires_server_result')),
  'plannedActions',jsonb_build_array(
    jsonb_build_object('nodeId',node,'type','crm_task','actionKey',actionkey)));
 plan:=jsonb_build_array(jsonb_build_object('flowVersionId',version,'decision',decision));
 refused:=false;
 BEGIN
   PERFORM public.automation_live_crm_finish(w,inbox,token,
    jsonb_build_array(jsonb_build_object('flowVersionId',version,
    'decision',jsonb_set(decision,'{plannedActions,0,actionKey}',to_jsonb(repeat('f',64))))));
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'FORGED_ACTION_KEY_ACCEPTED'; END IF;
 refused:=false;
 BEGIN
  PERFORM public.automation_live_crm_finish(w,inbox,token,
   jsonb_build_array(jsonb_build_object('flowVersionId',version,
    'decision',jsonb_set(decision,'{trace,0,nextPort}','"forged_port"'::jsonb))));
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'FORGED_BRANCH_ACCEPTED'; END IF;
 refused:=false;
 BEGIN
  PERFORM public.automation_live_crm_finish(w,inbox,token,
   jsonb_build_array(jsonb_build_object('flowVersionId',version,
    'decision',jsonb_set(decision,'{plannedActions,0,type}','"whatsapp_template"'::jsonb))));
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'UNREVIEWED_EXTERNAL_ACTION_ACCEPTED'; END IF;
 refused:=false;
 BEGIN
  PERFORM public.automation_live_crm_finish(w,inbox,token,
   jsonb_build_array(jsonb_build_object('flowVersionId',version,
    'decision',jsonb_set(decision,'{state}','"waiting"'::jsonb))));
 EXCEPTION WHEN invalid_parameter_value THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'LIVE_WAIT_WITHOUT_SCHEDULER_ACCEPTED'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_executions WHERE inbox_id=inbox)
 THEN RAISE EXCEPTION 'FORGED_ACTION_PERSISTED'; END IF;
 result:=public.automation_live_crm_finish(w,inbox,token,plan);
 IF result->>'ok'<>'true' OR result->>'dispatchAuthorized'<>'false'
 OR result->>'externalMessagesSent'<>'0'
 THEN RAISE EXCEPTION 'LIVE_CRM_ACK_INVALID: %',result; END IF;
 IF (SELECT count(*) FROM public.automation_action_outbox
 WHERE workspace_id=w AND action_type='crm_task' AND state='queued'
 AND action_key=actionkey)<>1
 THEN RAISE EXCEPTION 'DURABLE_CRM_ACTION_NOT_QUEUED'; END IF;
 refused:=false;
 BEGIN PERFORM public.automation_live_crm_finish(w,inbox,token,plan);
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 IF NOT refused THEN RAISE EXCEPTION 'LIVE_CRM_LEASE_REPLAY_ALLOWED'; END IF;
 UPDATE public.automation_runtime_settings SET emergency_stop=true WHERE workspace_id=w;
 IF EXISTS(SELECT 1 FROM public.automation_live_crm_claim(w,1))
 THEN RAISE EXCEPTION 'EMERGENCY_STOP_ALLOWED_CLAIM'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE workspace_id=w
  AND action_type IN('email','whatsapp_template','whatsapp_reply'))
 THEN RAISE EXCEPTION 'CRM_WORKER_CREATED_EXTERNAL_ACTION'; END IF;
END $qa$;
RESET ROLE;
ROLLBACK;
SELECT 'macro6-live-crm-fenced-queue-replay-pass' AS qa;
