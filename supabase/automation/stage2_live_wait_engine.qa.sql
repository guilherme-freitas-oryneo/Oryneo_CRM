-- PostgreSQL 17 disposable QA for the dormant Stage 2 live wait engine.
\set ON_ERROR_STOP on
BEGIN;
DO $qa$
DECLARE
 w uuid:='21000000-0000-4000-8000-000000000001';
 flow uuid:='21000000-0000-4000-8000-000000000002';
 version uuid:='21000000-0000-4000-8000-000000000003';
 inbox1 uuid:='21000000-0000-4000-8000-000000000004';
 inbox2 uuid:='21000000-0000-4000-8000-000000000005';
 inbox3 uuid:='21000000-0000-4000-8000-000000000006';
 ex1 uuid:='21000000-0000-4000-8000-000000000007';
 ex2 uuid:='21000000-0000-4000-8000-000000000008';
 ex3 uuid:='21000000-0000-4000-8000-000000000009';
 wait_node text:='21000000-0000-4000-8000-000000000010';
 end_node text:='21000000-0000-4000-8000-000000000011';
 convo uuid:='21000000-0000-4000-8000-000000000012';
 timer1 uuid;timer2 uuid;timer3 uuid;token1 uuid;token2 uuid;activation text;result jsonb;
 cancelled_count integer;recovered_count integer;timer_state text;execution_state text;
BEGIN
 IF has_function_privilege('anon','public.automation_live_wait_claim(uuid,integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.automation_live_wait_finish(uuid,uuid,uuid,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'LIVE_WAIT_FUNCTION_PUBLIC'; END IF;
 INSERT INTO public.automation_workspaces(id,slug,active) VALUES(w,'stage2-live-wait',true);
 INSERT INTO public.automation_runtime_settings(workspace_id,mode,emergency_stop)
  VALUES(w,'live',false);
 INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
  VALUES(flow,w,'stage2-wait','Stage 2 wait','pipeline',false);
 INSERT INTO public.automation_flow_versions(id,workspace_id,flow_id,version,schema_version,
  graph_json,content_sha256,status,published_by,published_at)
 VALUES(version,w,flow,1,'1.0.0',jsonb_build_object(
   'nodes',jsonb_build_array(
    jsonb_build_object('id',wait_node,'type','wait','config',jsonb_build_object('duration_minutes',5,'cancel_on_reply',true)),
    jsonb_build_object('id',end_node,'type','end','config','{}'::jsonb)),
   'edges',jsonb_build_array(jsonb_build_object('source',wait_node,'source_port','timeout','target',end_node))),
  repeat('a',64),'published','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp());
 UPDATE public.automation_flows SET enabled=true,published_version_id=version WHERE id=flow;
 INSERT INTO public.automation_event_inbox(id,workspace_id,source,event_id,event_type,schema_version,context_refs,state)
 VALUES
  (inbox1,w,'crm','stage2:1','opportunity.created','1.0.0',jsonb_build_object('conversation_id',convo),'processed'),
  (inbox2,w,'crm','stage2:2','opportunity.created','1.0.0',jsonb_build_object('conversation_id',convo),'processed'),
  (inbox3,w,'crm','stage2:3','opportunity.created','1.0.0',jsonb_build_object('conversation_id',convo),'processed');
 INSERT INTO public.automation_executions(id,workspace_id,flow_version_id,inbox_id,state)
 VALUES(ex1,w,version,inbox1,'running'),(ex2,w,version,inbox2,'running'),(ex3,w,version,inbox3,'running');

 timer1:=public.automation_live_wait_register(w,ex1,wait_node);
 IF timer1 IS NULL OR public.automation_live_wait_register(w,ex1,wait_node)<>timer1
 THEN RAISE EXCEPTION 'LIVE_WAIT_REGISTER_NOT_IDEMPOTENT'; END IF;
 UPDATE public.automation_live_waits SET due_at=clock_timestamp()-interval '1 second' WHERE id=timer1;
 SELECT claim_token INTO token1 FROM public.automation_live_wait_claim(w,10) WHERE wait_id=timer1;
 IF token1 IS NULL OR EXISTS(SELECT 1 FROM public.automation_live_wait_claim(w,10) WHERE wait_id=timer1)
 THEN RAISE EXCEPTION 'LIVE_WAIT_DOUBLE_CLAIM'; END IF;
 activation:=encode(sha256(convert_to(array_to_json(ARRAY[w::text,version::text,'crm','stage2:1'])::text,'UTF8')),'hex');
 BEGIN
  PERFORM public.automation_live_wait_finish(w,timer1,gen_random_uuid(),jsonb_build_object(
   'dispatchAuthorized',false,'state','completed','activationKey',activation,
   'trace',jsonb_build_array(jsonb_build_object('nodeId',end_node,'type','end','status','completed')),
   'plannedActions','[]'::jsonb));
  RAISE EXCEPTION 'LIVE_WAIT_STALE_TOKEN_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 result:=public.automation_live_wait_finish(w,timer1,token1,jsonb_build_object(
  'dispatchAuthorized',false,'state','completed','activationKey',activation,
  'trace',jsonb_build_array(jsonb_build_object('nodeId',end_node,'type','end','status','completed')),
  'plannedActions','[]'::jsonb));
 IF result->>'ok'<>'true'
  OR (SELECT state FROM public.automation_live_waits WHERE id=timer1)<>'resumed'
  OR (SELECT state FROM public.automation_executions WHERE id=ex1)<>'completed'
 THEN RAISE EXCEPTION 'LIVE_WAIT_COMPLETION_NOT_ATOMIC'; END IF;

 timer2:=public.automation_live_wait_register(w,ex2,wait_node);
 INSERT INTO public.crm_wa_messages(conversation_id,direction,occurred_at)
 VALUES(convo,'inbound',clock_timestamp()+interval '1 second');
 cancelled_count:=public.automation_live_wait_cancel_reply(w,convo);
 SELECT state INTO timer_state FROM public.automation_live_waits WHERE id=timer2;
 SELECT state INTO execution_state FROM public.automation_executions WHERE id=ex2;
 IF cancelled_count<>1 OR timer_state<>'cancelled' OR execution_state<>'cancelled'
 THEN RAISE EXCEPTION 'LIVE_WAIT_REPLY_NOT_CANCELLED count=% timer=% execution=%',
  cancelled_count,timer_state,execution_state; END IF;

 timer3:=public.automation_live_wait_register(w,ex3,wait_node);
 UPDATE public.automation_live_waits SET due_at=clock_timestamp()-interval '1 second',cancel_on_reply=false
  WHERE id=timer3;
 SELECT claim_token INTO token1 FROM public.automation_live_wait_claim(w,10) WHERE wait_id=timer3;
 UPDATE public.automation_live_waits SET lease_until=clock_timestamp()-interval '1 second' WHERE id=timer3;
 recovered_count:=public.automation_live_wait_recover(w,10);
 SELECT state INTO timer_state FROM public.automation_live_waits WHERE id=timer3;
 IF recovered_count<>1 OR timer_state<>'waiting'
 THEN RAISE EXCEPTION 'LIVE_WAIT_CRASH_NOT_RECOVERED count=% state=%',recovered_count,timer_state; END IF;
 SELECT claim_token INTO token2 FROM public.automation_live_wait_claim(w,10) WHERE wait_id=timer3;
 IF token2 IS NULL OR token2=token1 THEN RAISE EXCEPTION 'LIVE_WAIT_FENCE_NOT_ROTATED'; END IF;

 UPDATE public.automation_runtime_settings SET emergency_stop=true WHERE workspace_id=w;
 IF EXISTS(SELECT 1 FROM public.automation_live_wait_claim(w,10))
 THEN RAISE EXCEPTION 'LIVE_WAIT_KILL_SWITCH_IGNORED'; END IF;
END $qa$;
ROLLBACK;
SELECT 'stage2-live-wait-engine-qa-passed' AS qa;
