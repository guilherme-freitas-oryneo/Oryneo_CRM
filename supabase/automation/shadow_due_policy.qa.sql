-- Postgres 17 disposable only. Runs AFTER shadow_resume.qa.sql.
\set ON_ERROR_STOP on
DO $roles$
BEGIN
 IF has_function_privilege('anon','public.automation_wait_shadow_due_policy(uuid,uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.automation_wait_shadow_due_policy(uuid,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Due policy exposed to browser roles'; END IF;
END $roles$;
-- The disposable CRM message fixture grants service_role SELECT only.
-- Add write privileges to the isolated fixture, never to production.
GRANT INSERT,DELETE ON public.crm_wa_messages TO service_role;
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='af000000-0000-4000-8000-000000000001';
 v uuid:='af000000-0000-4000-8000-000000000003';
 trigger_node text:='9a000000-0000-4000-8000-000000000004';
 timer_node text:='9a000000-0000-4000-8000-000000000005';
 terminal_node text:='9a000000-0000-4000-8000-000000000008';
 c uuid:='bf000000-0000-4000-8000-000000000001';
 e uuid; t uuid; claimed record; resume_plan jsonb;
 outcome jsonb; guard_result text; denied boolean; k int;
BEGIN
 UPDATE public.automation_workspaces SET active=true WHERE id=w;
 UPDATE public.automation_runtime_settings SET mode='shadow',emergency_stop=false WHERE workspace_id=w;
 INSERT INTO public.crm_wa_conversations(id,mode,opted_out,consent_granted)
 VALUES(c,'sdr_active',false,true);
 resume_plan:=jsonb_build_object('shadowOnly',true,'dispatchAuthorized',false,
  'state','completed','trace',
  jsonb_build_array(jsonb_build_object('nodeId',terminal_node,'type','end','status','completed')),
  'plannedActions','[]'::jsonb);
 FOR k IN 1..4 LOOP
   e:=public.automation_shadow_ingest(w,'whatsapp','qa.due.policy.'||k,
    'conversation.inbound',jsonb_build_object('conversation_id',c));
   SELECT * INTO claimed FROM public.automation_shadow_claim(w,1);
   IF NOT FOUND OR claimed.inbox_id IS DISTINCT FROM e
    THEN RAISE EXCEPTION 'Expected claimed event %',k; END IF;
   PERFORM public.automation_shadow_finish(w,e,claimed.lease_token,
    jsonb_build_array(jsonb_build_object('flowVersionId',v,'decision',
      jsonb_build_object('shadowOnly',true,'dispatchAuthorized',false,
       'state','waiting','activationKey',repeat('c',64),'issues','[]'::jsonb,
       'plannedActions','[]'::jsonb,
       'trace',jsonb_build_array(
        jsonb_build_object('nodeId',trigger_node,'type','trigger','status','evaluated'),
        jsonb_build_object('nodeId',timer_node,'type','wait','status','waiting'))))));
   SELECT id INTO t FROM public.automation_wait_timers
    WHERE execution_id IN (SELECT id FROM public.automation_executions WHERE inbox_id=e)
     AND node_id=timer_node;
   IF t IS NULL THEN RAISE EXCEPTION 'Atomic timer % missing',k; END IF;
   UPDATE public.automation_wait_timers SET due_at=now()-interval '1 second'
    WHERE id=t;
   PERFORM public.automation_wait_shadow_poll(w,10);
   IF k=1 THEN
     IF public.automation_wait_shadow_due_policy(w,t)<>'ready'
     THEN RAISE EXCEPTION 'Safe due timer was denied'; END IF;
     outcome:=public.automation_wait_shadow_resume(w,t,resume_plan);
     IF outcome->>'resumed'<>'true'
     THEN RAISE EXCEPTION 'Safe due timer was not resumable'; END IF;
   ELSIF k=2 THEN
     UPDATE public.crm_wa_conversations SET mode='human_locked' WHERE id=c;
     guard_result:=public.automation_wait_shadow_due_policy(w,t);
     IF guard_result<>'cancelled' OR NOT EXISTS(
       SELECT 1 FROM public.automation_wait_timers
        WHERE id=t AND state='cancelled' AND reason_code='HUMAN_OR_REVIEW_MODE'
     ) THEN RAISE EXCEPTION 'Human takeover did not cancel due timer'; END IF;
     UPDATE public.crm_wa_conversations SET mode='sdr_active' WHERE id=c;
   ELSIF k=3 THEN
     -- Simulate a reply appearing AFTER poll, even after a successful preflight.
     IF public.automation_wait_shadow_due_policy(w,t)<>'ready'
     THEN RAISE EXCEPTION 'Unexpected preflight failure'; END IF;
     INSERT INTO public.crm_wa_messages
       (id,conversation_id,direction,body,occurred_at)
     VALUES('bf000000-0000-4000-8000-000000000010',c,'inbound',
       'private QA follow-up reply',clock_timestamp());
     denied:=false;
     BEGIN
       PERFORM public.automation_wait_shadow_resume(w,t,resume_plan);
     EXCEPTION WHEN insufficient_privilege THEN denied:=true;
     END;
     IF NOT denied THEN RAISE EXCEPTION 'Atomic resume ignored late inbound'; END IF;
     guard_result:=public.automation_wait_shadow_due_policy(w,t);
     IF guard_result<>'cancelled' OR NOT EXISTS(SELECT 1
       FROM public.automation_wait_timers WHERE id=t AND state='cancelled'
        AND reason_code='CANONICAL_INBOUND_RECEIVED')
     THEN RAISE EXCEPTION 'Late canonical reply was not cancelled'; END IF;
     DELETE FROM public.crm_wa_messages WHERE id='bf000000-0000-4000-8000-000000000010';
   ELSIF k=4 THEN
     UPDATE public.crm_wa_conversations SET opted_out=true WHERE id=c;
     denied:=false;
     BEGIN
       PERFORM public.automation_wait_shadow_resume(w,t,resume_plan);
     EXCEPTION WHEN insufficient_privilege THEN denied:=true;
     END;
     IF NOT denied THEN RAISE EXCEPTION 'Atomic resume ignored opt-out'; END IF;
     guard_result:=public.automation_wait_shadow_due_policy(w,t);
     IF guard_result<>'cancelled' THEN RAISE EXCEPTION 'Opt-out not cancelled'; END IF;
     UPDATE public.crm_wa_conversations SET opted_out=false WHERE id=c;
   END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox
  WHERE workspace_id=w AND state IN ('queued','leased','sent'))
 THEN RAISE EXCEPTION 'Due guard emitted actions'; END IF;
 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
END $qa$;
RESET ROLE;
SELECT 'shadow-due-policy-qa-passed' AS qa_result;
