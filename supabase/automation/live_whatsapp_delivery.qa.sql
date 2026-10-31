-- Macro 6: isolated Meta template claim, no provider request.
\set ON_ERROR_STOP on
ALTER TABLE public.crm_wa_conversations
 ADD COLUMN IF NOT EXISTS channel_id uuid,
 ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
CREATE TABLE IF NOT EXISTS public.crm_wa_channels(
 id uuid PRIMARY KEY,business_id text,messaging_account_id text,
 phone_number_id text,enabled boolean NOT NULL DEFAULT false
);
GRANT SELECT ON public.crm_wa_channels TO service_role;
GRANT SELECT ON public.crm_wa_conversations TO service_role;
\i supabase/automation/live_whatsapp_delivery.preview.sql
DO $acl$
BEGIN
 IF has_table_privilege('authenticated',
   'public.automation_whatsapp_provider_bindings','SELECT')
 OR has_function_privilege('anon',
   'public.automation_whatsapp_claim_template(uuid,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'META_CHANNEL_CLAIM_PUBLIC'; END IF;
END $acl$;
BEGIN;
UPDATE public.automation_workspaces SET active=true
 WHERE id='11111111-1111-4111-8111-111111111111';
UPDATE public.automation_runtime_settings
 SET mode='live',emergency_stop=false
 WHERE workspace_id='11111111-1111-4111-8111-111111111111';
UPDATE public.automation_channel_ownership SET
 owner='new_engine',legacy_dispatch_paused_at=clock_timestamp()-interval '2 minutes',
 release_approved_at=clock_timestamp(),release_id='qa-macro6-meta-release'
 WHERE workspace_id='11111111-1111-4111-8111-111111111111' AND channel='whatsapp';
INSERT INTO public.crm_wa_channels
(id,business_id,messaging_account_id,phone_number_id,enabled)
VALUES('c9000000-0000-4000-8000-000000000001','1111111111111111',
 '2222222222222222','3333333333333333',true);
INSERT INTO public.crm_wa_conversations
(id,channel_id,mode,opted_out,consent_granted,last_inbound_at)
VALUES('c9000000-0000-4000-8000-000000000002',
 'c9000000-0000-4000-8000-000000000001','sdr_active',false,true,
 clock_timestamp()-interval '1 day');
INSERT INTO public.automation_whatsapp_provider_bindings
(workspace_id,crm_channel_id,whatsapp_account_id,
 messaging_account_id,phone_number_id,verified_by,verified_at,
 release_approved_by,release_approved_at,enabled)
VALUES('11111111-1111-4111-8111-111111111111',
 'c9000000-0000-4000-8000-000000000001','4444444444444444',
 '2222222222222222','3333333333333333',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp()-interval '1 hour',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp()-interval '15 minutes',true);
INSERT INTO public.automation_template_registry
(id,workspace_id,provider_account_id,provider_template_id,template_name,
 language,category,provider_status,parameter_schema)
VALUES('c9000000-0000-4000-8000-000000000003',
 '11111111-1111-4111-8111-111111111111',
 '2222222222222222','5555555555555555','oryneo_utility_example_v3',
 'pt_BR','UTILITY','APPROVED',
 '{"components_verified":true,"variable_numbers":["1"]}'::jsonb);
INSERT INTO public.automation_flows
(id,workspace_id,slug,name,kind,enabled)
VALUES('c9000000-0000-4000-8000-000000000004',
 '11111111-1111-4111-8111-111111111111',
 'qa-macro6-meta','Meta QA','pipeline',false);
INSERT INTO public.automation_flow_versions
(id,workspace_id,flow_id,version,schema_version,graph_json,status,
 content_sha256,published_by,published_at)
VALUES('c9000000-0000-4000-8000-000000000005',
 '11111111-1111-4111-8111-111111111111',
 'c9000000-0000-4000-8000-000000000004',1,'1.0.0',
 '{"nodes":[{"id":"c9000000-0000-4000-8000-000000000010",
  "type":"whatsapp_template","config":{"template_registry_id":"c9000000-0000-4000-8000-000000000003",
  "locale":"pt_BR","bindings":{"1":"conversation.customer_name"}}}]}'::jsonb,
 'published',repeat('a',64),'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp());
UPDATE public.automation_flows SET enabled=true,
 published_version_id='c9000000-0000-4000-8000-000000000005'
 WHERE id='c9000000-0000-4000-8000-000000000004';
INSERT INTO public.automation_event_inbox
(id,workspace_id,source,event_id,event_type,schema_version,
 context_refs,state,received_at)
VALUES('c9000000-0000-4000-8000-000000000006',
 '11111111-1111-4111-8111-111111111111',
 'whatsapp','wa:c9000000-0000-4000-8000-000000000006',
 'conversation.inbound','1.0.0',
 '{"conversation_id":"c9000000-0000-4000-8000-000000000002"}',
 'processed',clock_timestamp());
INSERT INTO public.automation_executions
(id,workspace_id,flow_version_id,inbox_id,state)
VALUES('c9000000-0000-4000-8000-000000000007',
 '11111111-1111-4111-8111-111111111111',
 'c9000000-0000-4000-8000-000000000005',
 'c9000000-0000-4000-8000-000000000006','running');
INSERT INTO public.automation_action_outbox
(id,workspace_id,execution_id,node_id,action_key,action_type,state)
VALUES('c9000000-0000-4000-8000-000000000008',
 '11111111-1111-4111-8111-111111111111',
 'c9000000-0000-4000-8000-000000000007',
 'c9000000-0000-4000-8000-000000000010',repeat('b',64),
 'whatsapp_template','queued');
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 action uuid:='c9000000-0000-4000-8000-000000000008';
 convo uuid:='c9000000-0000-4000-8000-000000000002';
 v record;counted integer:=0;
BEGIN
 FOR v IN SELECT * FROM public.automation_whatsapp_claim_template(w,2) LOOP
  IF v.action_id<>action OR v.template_registry_id IS NULL OR
   v.phone_number_id<>'3333333333333333'
  THEN RAISE EXCEPTION 'META_CLAIM_ROUTED_WRONG_PROVIDER'; END IF;
  counted:=counted+1;
 END LOOP;
 IF counted<>1 THEN RAISE EXCEPTION 'VALID_UTILITY_TEMPLATE_NOT_CLAIMED'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_whatsapp_claim_template(w,2))
 THEN RAISE EXCEPTION 'META_DUPLICATE_CLAIM'; END IF;
 UPDATE public.automation_action_outbox SET state='queued',
 claim_token=NULL,lease_until=NULL WHERE id=action;
 UPDATE public.crm_wa_conversations SET opted_out=true WHERE id=convo;
 IF EXISTS(SELECT 1 FROM public.automation_whatsapp_claim_template(w,2))
 THEN RAISE EXCEPTION 'META_OPT_OUT_IGNORED'; END IF;
 UPDATE public.crm_wa_conversations SET opted_out=false WHERE id=convo;
 UPDATE public.automation_template_registry SET provider_status='PAUSED'
  WHERE id='c9000000-0000-4000-8000-000000000003';
 IF EXISTS(SELECT 1 FROM public.automation_whatsapp_claim_template(w,2))
 THEN RAISE EXCEPTION 'META_PAUSED_TEMPLATE_CLAIMED'; END IF;
 UPDATE public.automation_template_registry SET provider_status='APPROVED'
 WHERE id='c9000000-0000-4000-8000-000000000003';
 UPDATE public.automation_runtime_settings SET emergency_stop=true WHERE workspace_id=w;
 IF EXISTS(SELECT 1 FROM public.automation_whatsapp_claim_template(w,2))
 THEN RAISE EXCEPTION 'META_KILL_SWITCH_IGNORED'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox
 WHERE id=action AND state='sent')
 THEN RAISE EXCEPTION 'META_CLAIM_SENT_MESSAGE'; END IF;
END $qa$;
RESET ROLE;
ROLLBACK;
SELECT 'macro6-whatsapp-approved-template-consent-claim-qa-passed' AS qa;
