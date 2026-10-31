-- All data and side effects confined to the disposable PostgreSQL QA service.
\set ON_ERROR_STOP on
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='9a000000-0000-4000-8000-000000000001';
 f uuid:='9a000000-0000-4000-8000-000000000002';
 v uuid:='9a000000-0000-4000-8000-000000000003';
 trig text:='9a000000-0000-4000-8000-000000000004';
 timer text:='9a000000-0000-4000-8000-000000000005';
 conv uuid:='9a000000-0000-4000-8000-000000000006';
 inbox uuid; token uuid; receipt jsonb; trace jsonb;
 msg uuid:='9a000000-0000-4000-8000-000000000007';
 claimed record; wait_id uuid; blocked boolean:=false;
BEGIN
 INSERT INTO public.automation_workspaces(id,slug,active)
  VALUES(w,'qa-isolated-atomic-wait',true);
 INSERT INTO public.automation_runtime_settings(workspace_id,mode,emergency_stop)
  VALUES(w,'shadow',false);
 INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
  VALUES(f,w,'qa-wait','QA shadow timer','sdr',false);
 INSERT INTO public.automation_flow_versions(
   id,workspace_id,flow_id,version,schema_version,status,content_sha256,
   graph_json,published_at,published_by)
 VALUES(v,w,f,1,'1.0.0','published',repeat('b',64),
 jsonb_build_object(
  'id',f,'name','QA shadow timer','kind','sdr','status','published',
  'schema_version','1.0.0','version',1,
  'nodes',jsonb_build_array(
   jsonb_build_object('id',trig,'type','trigger','label','WA inbound',
     'position',jsonb_build_object('x',50,'y',100),
     'config',jsonb_build_object('event_type','conversation.inbound'),
     'ports',jsonb_build_array('out')),
   jsonb_build_object('id',timer,'type','wait','label','Delay',
     'position',jsonb_build_object('x',300,'y',100),
     'config',jsonb_build_object('duration_minutes',60,'cancel_on_reply',true),
     'ports',jsonb_build_array('in','out','timeout')),
   jsonb_build_object('id','9a000000-0000-4000-8000-000000000008',
     'type','end','label','Done','position',jsonb_build_object('x',600,'y',100),
     'config','{}'::jsonb,'ports',jsonb_build_array('in')),
   jsonb_build_object('id','9a000000-0000-4000-8000-000000000009',
     'type','stop','label','Timeout','position',jsonb_build_object('x',600,'y',300),
     'config','{}'::jsonb,'ports',jsonb_build_array('in'))
  ),
  'edges',jsonb_build_array(
   jsonb_build_object('id','9a000000-0000-4000-8000-000000000010',
     'source',trig,'source_port','out','target',timer,'target_port','in'),
   jsonb_build_object('id','9a000000-0000-4000-8000-000000000011',
     'source',timer,'source_port','out',
     'target','9a000000-0000-4000-8000-000000000008','target_port','in'),
   jsonb_build_object('id','9a000000-0000-4000-8000-000000000012',
     'source',timer,'source_port','timeout',
     'target','9a000000-0000-4000-8000-000000000009','target_port','in')
  )
 ),now(),'9a000000-0000-4000-8000-000000000099');
 UPDATE public.automation_flows SET published_version_id=v WHERE id=f;

 inbox:=public.automation_shadow_ingest(w,'whatsapp','qa.atomic.1',
   'conversation.inbound',jsonb_build_object('conversation_id',conv));
 SELECT * INTO claimed FROM public.automation_shadow_claim(w,1);
 IF NOT FOUND OR claimed.inbox_id IS DISTINCT FROM inbox THEN
   RAISE EXCEPTION 'Inbound not claimed'; END IF;
 trace:=jsonb_build_array(
   jsonb_build_object('nodeId',trig,'type','trigger','status','evaluated'),
   jsonb_build_object('nodeId',timer,'type','wait','status','waiting'));
 receipt:=public.automation_shadow_finish(w,inbox,claimed.lease_token,
  jsonb_build_array(jsonb_build_object(
    'flowVersionId',v,'decision',jsonb_build_object(
       'shadowOnly',true,'dispatchAuthorized',false,'state','waiting',
       'activationKey',repeat('c',64),'trace',trace,
       'plannedActions','[]'::jsonb,'issues','[]'::jsonb))));
 IF receipt->>'flowCount'<>'1' THEN RAISE EXCEPTION 'No flow finished'; END IF;
 SELECT id INTO wait_id FROM public.automation_wait_timers
  WHERE workspace_id=w AND node_id=timer;
 IF wait_id IS NULL OR NOT EXISTS(
   SELECT 1 FROM public.automation_wait_timers
   WHERE id=wait_id AND state='waiting' AND cancel_on_reply
     AND conversation_id=conv AND due_at>clock_timestamp())
 THEN RAISE EXCEPTION 'Atomic timer was not registered'; END IF;
 -- Duplicated event cannot create another execution or timer.
 IF public.automation_shadow_ingest(w,'whatsapp','qa.atomic.1',
   'conversation.inbound',jsonb_build_object('conversation_id',conv)) IS DISTINCT FROM inbox
 THEN RAISE EXCEPTION 'Duplicate inbound got a new id'; END IF;
 IF (SELECT count(*) FROM public.automation_wait_timers WHERE workspace_id=w)<>1
 THEN RAISE EXCEPTION 'Duplicate timer in atomic path'; END IF;
 INSERT INTO public.crm_wa_messages(id,conversation_id,direction,body,occurred_at)
  VALUES(msg,conv,'inbound','private reply',clock_timestamp());
 IF public.automation_wait_shadow_cancel_reply(w,conv)<>1
 THEN RAISE EXCEPTION 'Inbound did not cancel registered timer'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_wait_timers
  WHERE id=wait_id AND state='cancelled' AND observed_reply_id=msg)
 THEN RAISE EXCEPTION 'Missing canonical cancellation audit'; END IF;

 -- A wait lacking the canonical conversation cannot be acknowledged.
 inbox:=public.automation_shadow_ingest(w,'whatsapp','qa.atomic.2',
   'conversation.inbound','{}'::jsonb);
 SELECT * INTO claimed FROM public.automation_shadow_claim(w,1);
 IF NOT FOUND OR claimed.inbox_id IS DISTINCT FROM inbox THEN
  RAISE EXCEPTION 'Second inbound not claimed'; END IF;
 blocked:=false;
 BEGIN
   PERFORM public.automation_shadow_finish(w,inbox,claimed.lease_token,
     jsonb_build_array(jsonb_build_object(
       'flowVersionId',v,'decision',jsonb_build_object(
       'shadowOnly',true,'dispatchAuthorized',false,'state','waiting',
       'activationKey',repeat('d',64),'trace',trace,
       'plannedActions','[]'::jsonb,'issues','[]'::jsonb))));
 EXCEPTION WHEN invalid_parameter_value THEN blocked:=true;
 END;
 IF NOT blocked OR NOT EXISTS(SELECT 1 FROM public.automation_event_inbox
     WHERE id=inbox AND state='pending')
 THEN RAISE EXCEPTION 'Missing conversation silently acknowledged a timer'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE workspace_id=w)
 THEN RAISE EXCEPTION 'Timer emitted external action'; END IF;
 UPDATE public.automation_runtime_settings
  SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
END; $qa$;
RESET ROLE;
SELECT 'atomic-shadow-trace-wait-qa-passed' AS qa_result;
