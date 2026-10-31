-- Disposable PostgreSQL 17: no Meta, SMTP, Stripe or CRM network calls.
\set ON_ERROR_STOP on
-- Fixture controlled entirely by this QA, independent of earlier default workspace.
INSERT INTO public.automation_workspaces(id,slug,active)
 VALUES('b1000000-0000-4000-8000-000000000001','qa-delivery-protocol',true);
INSERT INTO public.automation_runtime_settings(workspace_id,mode,emergency_stop)
 VALUES('b1000000-0000-4000-8000-000000000001','live',false);
INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
 VALUES('b1000000-0000-4000-8000-000000000002',
  'b1000000-0000-4000-8000-000000000001',
  'qa-delivery-protocol','QA no-send delivery','pipeline',false);
INSERT INTO public.automation_flow_versions(
 id,workspace_id,flow_id,version,schema_version,graph_json,
 content_sha256,status,published_by,published_at)
 VALUES(
 'b1000000-0000-4000-8000-000000000003',
 'b1000000-0000-4000-8000-000000000001',
 'b1000000-0000-4000-8000-000000000002',1,'1.0.0',
 '{"nodes":[{"id":"b1000000-0000-4000-8000-000000000004",
 "type":"whatsapp_template","config":{"template_registry_id":"b1000000-0000-4000-8000-000000000010",
 "locale":"pt_BR"}}],"edges":[]}'::jsonb,
 repeat('a',64),'published','b1000000-0000-4000-8000-000000000009',now());
UPDATE public.automation_flows SET
 published_version_id='b1000000-0000-4000-8000-000000000003',enabled=true
 WHERE id='b1000000-0000-4000-8000-000000000002';
INSERT INTO public.automation_event_inbox(
 id,workspace_id,source,event_id,event_type,schema_version)
 VALUES('b1000000-0000-4000-8000-000000000005',
  'b1000000-0000-4000-8000-000000000001','crm',
  'qa.delivery.1','opportunity.created','1.0.0');
INSERT INTO public.automation_executions(
 id,workspace_id,flow_version_id,inbox_id,state)
 VALUES('b1000000-0000-4000-8000-000000000006',
  'b1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000003',
  'b1000000-0000-4000-8000-000000000005','running');
INSERT INTO public.automation_action_outbox(
 id,workspace_id,execution_id,node_id,action_key,action_type,state,due_at)
 VALUES
 ('b1000000-0000-4000-8000-000000000007',
  'b1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000006',
  'b1000000-0000-4000-8000-000000000004',repeat('c',64),
  'whatsapp_template','queued',now()-interval '1 minute'),
 ('b1000000-0000-4000-8000-000000000008',
  'b1000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000006',
  'b1000000-0000-4000-8000-000000000004',repeat('d',64),
  'whatsapp_template','queued',now()-interval '1 minute');

SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='b1000000-0000-4000-8000-000000000001';
 a uuid:='b1000000-0000-4000-8000-000000000007';
 b uuid:='b1000000-0000-4000-8000-000000000008';
 first_claim record;
 second_claim record;
 denied boolean:=false;
BEGIN
 SELECT * INTO first_claim FROM public.automation_delivery_claim(w,1);
 IF NOT FOUND OR first_claim.action_id IS DISTINCT FROM a OR first_claim.attempt<>1
 THEN RAISE EXCEPTION 'First queue item was not leased with one attempt'; END IF;
 SELECT * INTO second_claim FROM public.automation_delivery_claim(w,1);
 IF NOT FOUND OR second_claim.action_id IS DISTINCT FROM b
 THEN RAISE EXCEPTION 'Second worker did not claim the other action'; END IF;
 denied:=false;
 BEGIN
   PERFORM public.automation_delivery_finish(w,a,
     'b1000000-0000-4000-8000-000000000099','sent','wamid:qa');
 EXCEPTION WHEN serialization_failure THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Old/wrong claim token acknowledged an action'; END IF;
 IF public.automation_delivery_finish(w,a,first_claim.claim_token,'sent','wamid:qa')<>'sent'
 THEN RAISE EXCEPTION 'Provider receipt was not persisted'; END IF;
 IF public.automation_delivery_finish(w,a,first_claim.claim_token,'sent','wamid:qa')<>'sent'
 THEN RAISE EXCEPTION 'Duplicate identical receipt not idempotent'; END IF;
 denied:=false;
 BEGIN
   PERFORM public.automation_delivery_finish(w,a,first_claim.claim_token,'sent','wamid:other');
 EXCEPTION WHEN serialization_failure THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Conflicting provider receipt was accepted'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_delivery_claim(w,10) WHERE action_id=a)
 THEN RAISE EXCEPTION 'Already sent action was claimed again'; END IF;
 -- Remaining action enters leased state and then suffers unknown provider result.
 -- A production worker must NEVER shorten its own lease; in this disposable
 -- fixture we backdate the clock field with the trigger temporarily disabled.
END; $qa$;
RESET ROLE;
BEGIN;
ALTER TABLE public.automation_action_outbox DISABLE TRIGGER automation_outbox_runtime_gate;
UPDATE public.automation_action_outbox
 SET lease_until=clock_timestamp()-interval '1 second'
 WHERE id='b1000000-0000-4000-8000-000000000008';
ALTER TABLE public.automation_action_outbox ENABLE TRIGGER automation_outbox_runtime_gate;
COMMIT;
SET ROLE service_role;
DO $qa_late$
DECLARE
 w uuid:='b1000000-0000-4000-8000-000000000001';
 a uuid:='b1000000-0000-4000-8000-000000000007';
 b uuid:='b1000000-0000-4000-8000-000000000008';
 first_claim record; second_claim record;
 denied boolean:=false;
BEGIN
 SELECT claim_token INTO first_claim FROM public.automation_action_outbox WHERE id=a;
 SELECT claim_token INTO second_claim FROM public.automation_action_outbox WHERE id=b;
 IF first_claim.claim_token IS NULL OR second_claim.claim_token IS NULL
 THEN RAISE EXCEPTION 'Fixture lost claimed tokens'; END IF;
 IF public.automation_delivery_expire_uncertain(w,10)<>1
 THEN RAISE EXCEPTION 'Expired outbound lease did not become uncertain'; END IF;
 IF (SELECT state FROM public.automation_action_outbox WHERE id=b)<>'uncertain'
 THEN RAISE EXCEPTION 'Potentially delivered action was automatically retried'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_delivery_claim(w,10))
 THEN RAISE EXCEPTION 'Uncertain outbound was claimed for another send'; END IF;
 IF public.automation_delivery_reconcile_receipt(w,b,second_claim.claim_token,
     'wamid:late-ack')<>'sent'
 THEN RAISE EXCEPTION 'Late confirmed provider receipt was not reconciled'; END IF;
 denied:=false;
 BEGIN
  PERFORM public.automation_delivery_reconcile_receipt(w,b,second_claim.claim_token,
    'wamid:conflict');
 EXCEPTION WHEN serialization_failure THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Conflicting late receipt replaced canonical ack'; END IF;
 IF (SELECT count(*) FROM public.automation_action_outbox
     WHERE workspace_id=w AND state='sent')<>2
 THEN RAISE EXCEPTION 'Fenced delivery receipts not recorded exactly once'; END IF;
 denied:=false;
 BEGIN
   UPDATE public.automation_action_outbox SET provider_result_id='wamid:qa' WHERE id=b;
 EXCEPTION WHEN unique_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'Provider receipt was reused across distinct actions'; END IF;
 -- A disabled flow blocks claiming even when the global live flag is on.
 UPDATE public.automation_flows SET enabled=false
  WHERE id='b1000000-0000-4000-8000-000000000002';
 INSERT INTO public.automation_action_outbox(
 id,workspace_id,execution_id,node_id,action_key,action_type,state)
 VALUES('b1000000-0000-4000-8000-000000000011',w,
  'b1000000-0000-4000-8000-000000000006',
  'b1000000-0000-4000-8000-000000000004',repeat('e',64),
  'whatsapp_template','queued');
 IF EXISTS(SELECT 1 FROM public.automation_delivery_claim(w,10))
 THEN RAISE EXCEPTION 'A disabled flow dispatched a provider action'; END IF;
 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true
 WHERE workspace_id=w;
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
 IF EXISTS(SELECT 1 FROM public.automation_delivery_claim(w,10))
 THEN RAISE EXCEPTION 'Global emergency stop did not block provider lease'; END IF;
 -- Reconcile existing already-sent result is still possible during emergency.
 IF public.automation_delivery_reconcile_receipt(w,a,first_claim.claim_token,'wamid:qa')<>'sent'
 THEN RAISE EXCEPTION 'Emergency stop erased a previously confirmed receipt'; END IF;
END; $qa_late$;
RESET ROLE;
DO $permissions$
BEGIN
 IF has_function_privilege('anon','public.automation_delivery_claim(uuid,integer)','EXECUTE')
 OR has_function_privilege('authenticated','public.automation_delivery_finish(uuid,uuid,uuid,text,text)','EXECUTE')
 OR has_table_privilege('authenticated','public.automation_action_outbox','UPDATE')
 THEN RAISE EXCEPTION 'Delivery protocol was exposed to browser roles'; END IF;
END; $permissions$;
-- Cleanup ONLY the synthetic queued fixture; keep the sent rows for validation.
UPDATE public.automation_action_outbox SET state='cancelled'
 WHERE id='b1000000-0000-4000-8000-000000000011';
SELECT 'outbox-fenced-delivery-protocol-qa-passed' AS qa_result;
