-- Disposable DB test: a service-role caller may NOT queue work while stopped.
\set ON_ERROR_STOP on
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 exe uuid; action uuid;
 blocked boolean:=false;
BEGIN
 SELECT id INTO exe FROM public.automation_executions
  WHERE workspace_id=w ORDER BY started_at LIMIT 1;
 IF exe IS NULL THEN RAISE EXCEPTION 'Missing shadow execution fixture'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_runtime_settings
  WHERE workspace_id=w AND mode='disabled' AND emergency_stop)
 THEN
  UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
  UPDATE public.automation_workspaces SET active=false WHERE id=w;
 END IF;
 INSERT INTO public.automation_action_outbox
  (workspace_id,execution_id,node_id,action_key,action_type,state)
 VALUES(w,exe,'77777777-7777-4777-8777-777777777777',repeat('b',64),
  'whatsapp_template','blocked') RETURNING id INTO action;
 BEGIN
  UPDATE public.automation_action_outbox SET state='queued' WHERE id=action;
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
 END;
 IF NOT blocked OR (SELECT state FROM public.automation_action_outbox WHERE id=action)<>'blocked'
 THEN RAISE EXCEPTION 'Disabled mode permitted outbound queue'; END IF;
 UPDATE public.automation_workspaces SET active=true WHERE id=w;
 UPDATE public.automation_runtime_settings SET mode='shadow',emergency_stop=false WHERE workspace_id=w;
 blocked:=false;
 BEGIN
  UPDATE public.automation_action_outbox SET state='queued' WHERE id=action;
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'Shadow mode permitted outbound queue'; END IF;
 UPDATE public.automation_runtime_settings SET mode='live',emergency_stop=false WHERE workspace_id=w;
 UPDATE public.automation_action_outbox SET state='queued' WHERE id=action;
 blocked:=false;
 BEGIN
  UPDATE public.automation_action_outbox SET state='leased' WHERE id=action;
 EXCEPTION WHEN invalid_parameter_value THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'Lease without bounded expiry accepted'; END IF;
 UPDATE public.automation_action_outbox SET state='leased',
   lease_until=clock_timestamp()+interval '90 seconds' WHERE id=action;
 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
 -- A network send could already have completed when the switch is pulled:
 -- reporting that result must remain possible, but no NEXT action may queue.
 UPDATE public.automation_action_outbox SET state='sent',provider_result_id='qa-no-provider-call'
 WHERE id=action;
 blocked:=false;
 BEGIN
  UPDATE public.automation_action_outbox SET state='queued' WHERE id=action;
 EXCEPTION WHEN insufficient_privilege THEN blocked:=true;
 END;
 IF NOT blocked THEN RAISE EXCEPTION 'Runtime stop allowed requeue of prior delivery'; END IF;
 IF (SELECT state FROM public.automation_action_outbox WHERE id=action)<>'sent'
 THEN RAISE EXCEPTION 'Reconciled provider state was lost'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox
   WHERE state IN ('queued','leased'))
 THEN RAISE EXCEPTION 'Test leaked schedulable actions'; END IF;
END; $qa$;
RESET ROLE;
DO $permissions$
BEGIN
 IF has_function_privilege('anon',
   'public.automation_outbox_prevent_premature_queue()','EXECUTE')
   OR has_table_privilege('authenticated','public.automation_action_outbox','UPDATE')
 THEN RAISE EXCEPTION 'Outbox gate exposed to browser role'; END IF;
END; $permissions$;
SELECT 'outbox-runtime-gate-qa-passed' AS qa_result;
