-- PostgreSQL 17 disposable QA for dormant e-mail and WhatsApp reply claims.
\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
DO $qa$
DECLARE
 w uuid:='23000000-0000-4000-8000-000000000001'; actor uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 mailbox uuid:='23000000-0000-4000-8000-000000000002';deal uuid:='23000000-0000-4000-8000-000000000003';
 email_template uuid:='23000000-0000-4000-8000-000000000004';
 email_flow uuid:='23000000-0000-4000-8000-000000000005';email_version uuid:='23000000-0000-4000-8000-000000000006';
 email_inbox uuid:='23000000-0000-4000-8000-000000000007';email_execution uuid:='23000000-0000-4000-8000-000000000008';
 email_node text:='23000000-0000-4000-8000-000000000009';email_action uuid:='23000000-0000-4000-8000-000000000010';
 channel uuid:='23000000-0000-4000-8000-000000000011';conversation uuid:='23000000-0000-4000-8000-000000000012';
 wa_flow uuid:='23000000-0000-4000-8000-000000000013';wa_version uuid:='23000000-0000-4000-8000-000000000014';
 wa_inbox uuid:='23000000-0000-4000-8000-000000000015';wa_execution uuid:='23000000-0000-4000-8000-000000000016';
 wa_node text:='23000000-0000-4000-8000-000000000017';wa_action uuid:='23000000-0000-4000-8000-000000000018';
 email_claim record;wa_claim record;consent_visible boolean;consent_revoked boolean;consent_audited boolean;
BEGIN
 IF has_function_privilege('authenticated','public.automation_email_claim(uuid,integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.automation_whatsapp_claim_reply(uuid,integer)','EXECUTE')
  OR has_function_privilege('authenticated','public.automation_consent_status(uuid,uuid)','EXECUTE')
  OR has_function_privilege('authenticated','public.automation_consent_revoke(uuid,text,uuid,text,text,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'CHANNEL_CLAIM_PUBLIC'; END IF;
 INSERT INTO public.automation_workspaces(id,slug,active) VALUES(w,'stage2-channel-executors',true);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 INSERT INTO public.automation_workspace_members(workspace_id,user_id,role,granted_by)
 VALUES(w,actor,'admin',actor);
 INSERT INTO public.automation_runtime_settings(workspace_id,mode,emergency_stop) VALUES(w,'live',false);
 INSERT INTO public.automation_channel_ownership(workspace_id,channel,owner,legacy_dispatch_paused_at,release_approved_at,release_id)
 VALUES(w,'email','new_engine',clock_timestamp(),clock_timestamp(),'qa-email'),
  (w,'whatsapp','new_engine',clock_timestamp(),clock_timestamp(),'qa-wa');
 INSERT INTO public.crm_mailboxes(id) VALUES(mailbox);
 INSERT INTO public.automation_email_provider_bindings(workspace_id,mailbox_id,verified_by,verified_at,
  release_approved_by,release_approved_at,enabled)
 VALUES(w,mailbox,actor,clock_timestamp()-interval '2 minutes',actor,clock_timestamp()-interval '1 minute',true);
 INSERT INTO public.crm_records(id,kind,data,deleted) VALUES(deal,'deal',
  '{"email":"cliente@example.com","contact":"Ana","company":"Cliente QA"}',false);
 INSERT INTO public.automation_email_template_registry(id,workspace_id,name,subject_template,
  body_text_template,purpose,status,content_sha256,approved_by,approved_at)
 VALUES(email_template,w,'diagnostico_v1','Olá, {{contact_name}}','Mensagem para {{company}}.',
  'diagnosis','approved',repeat('a',64),actor,clock_timestamp());
 INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
 VALUES(email_flow,w,'qa-email-flow','QA e-mail','pipeline',false);
 INSERT INTO public.automation_flow_versions(id,workspace_id,flow_id,version,schema_version,graph_json,
  content_sha256,status,published_by,published_at)
 VALUES(email_version,w,email_flow,1,'1.0.0',jsonb_build_object('nodes',jsonb_build_array(
  jsonb_build_object('id',email_node,'type','email','config',jsonb_build_object(
   'template_id',email_template,'recipient_field','opportunity.email'))),'edges','[]'::jsonb),
  repeat('b',64),'published',actor,clock_timestamp());
 UPDATE public.automation_flows SET enabled=true,published_version_id=email_version WHERE id=email_flow;
 INSERT INTO public.automation_event_inbox(id,workspace_id,source,event_id,event_type,schema_version,context_refs,state)
 VALUES(email_inbox,w,'crm','qa:email','opportunity.created','1.0.0',jsonb_build_object('opportunity_id',deal),'processed');
 INSERT INTO public.automation_executions(id,workspace_id,flow_version_id,inbox_id,state)
 VALUES(email_execution,w,email_version,email_inbox,'running');
 INSERT INTO public.automation_action_outbox(id,workspace_id,execution_id,node_id,action_key,action_type,state)
 VALUES(email_action,w,email_execution,email_node,repeat('c',64),'email','queued');
 IF EXISTS(SELECT 1 FROM public.automation_email_claim(w,3))
 THEN RAISE EXCEPTION 'EMAIL_WITHOUT_PURPOSE_CONSENT_CLAIMED'; END IF;
 INSERT INTO public.automation_email_consents(workspace_id,opportunity_id,purpose,recipient_sha256,
  proof_kind,proof_sha256,granted_at,verified_by,verified_at)
 VALUES(w,deal,'diagnosis',encode(sha256(convert_to('cliente@example.com','UTF8')),'hex'),
  'explicit_inbound',repeat('d',64),clock_timestamp()-interval '2 minutes',actor,clock_timestamp()-interval '1 minute');
 SELECT * INTO email_claim FROM public.automation_email_claim(w,3);
 IF email_claim.action_id<>email_action OR email_claim.recipient<>'cliente@example.com'
  OR NOT public.automation_email_pre_send(w,email_action,email_claim.claim_token,deal,
   email_claim.recipient,mailbox,email_template)
 THEN RAISE EXCEPTION 'VERIFIED_EMAIL_NOT_FENCED_FOR_SEND'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.automation_consent_status(w,deal) consent_status
   WHERE consent_status.channel='email' AND consent_status.purpose='diagnosis' AND consent_status.active)
  INTO consent_visible;
 consent_revoked:=public.automation_consent_revoke(w,'email',deal,'diagnosis','Solicitação do contato',actor);
 SELECT EXISTS(SELECT 1 FROM public.automation_consent_audit consent_audit
   WHERE consent_audit.workspace_id=w AND consent_audit.channel='email'
    AND consent_audit.subject_id=deal AND consent_audit.actor_id=actor) INTO consent_audited;
 IF NOT consent_visible OR NOT consent_revoked OR NOT consent_audited
 THEN RAISE EXCEPTION 'CONSENT_READ_REVOKE_PATH_FAILED visible=% revoked=% audited=%',
  consent_visible,consent_revoked,consent_audited; END IF;
 IF public.automation_email_pre_send(w,email_action,email_claim.claim_token,deal,
   email_claim.recipient,mailbox,email_template)
 THEN RAISE EXCEPTION 'REVOKED_EMAIL_CONSENT_ALLOWED'; END IF;

 INSERT INTO public.crm_wa_channels(id,enabled,phone_number_id,messaging_account_id)
 VALUES(channel,true,'1322421900964911','28794700556857948');
 INSERT INTO public.crm_wa_conversations(id,channel_id,mode,opted_out,consent_granted,last_inbound_at)
 VALUES(conversation,channel,'sdr_active',false,true,clock_timestamp()-interval '25 hours');
 INSERT INTO public.automation_whatsapp_provider_bindings(workspace_id,crm_channel_id,phone_number_id,enabled)
 VALUES(w,channel,'1322421900964911',true);
 INSERT INTO public.automation_sdr_reply_registry(workspace_id,text_ref,body_text,status,content_sha256,approved_by,approved_at)
 VALUES(w,'diagnostico_inicio_v1','Oi! Vamos começar seu diagnóstico?','approved',repeat('e',64),actor,clock_timestamp());
 INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
 VALUES(wa_flow,w,'qa-wa-flow','QA WhatsApp','sdr',false);
 INSERT INTO public.automation_flow_versions(id,workspace_id,flow_id,version,schema_version,graph_json,
  content_sha256,status,published_by,published_at)
 VALUES(wa_version,w,wa_flow,1,'1.0.0',jsonb_build_object('nodes',jsonb_build_array(
  jsonb_build_object('id',wa_node,'type','whatsapp_reply','config',jsonb_build_object(
   'text_ref','diagnostico_inicio_v1'))),'edges','[]'::jsonb),repeat('f',64),'published',actor,clock_timestamp());
 UPDATE public.automation_flows SET enabled=true,published_version_id=wa_version WHERE id=wa_flow;
 INSERT INTO public.automation_event_inbox(id,workspace_id,source,event_id,event_type,schema_version,context_refs,state)
 VALUES(wa_inbox,w,'whatsapp','qa:wa','conversation.inbound','1.0.0',jsonb_build_object('conversation_id',conversation),'processed');
 INSERT INTO public.automation_executions(id,workspace_id,flow_version_id,inbox_id,state)
 VALUES(wa_execution,w,wa_version,wa_inbox,'running');
 INSERT INTO public.automation_action_outbox(id,workspace_id,execution_id,node_id,action_key,action_type,state)
 VALUES(wa_action,w,wa_execution,wa_node,repeat('1',64),'whatsapp_reply','queued');
 IF EXISTS(SELECT 1 FROM public.automation_whatsapp_claim_reply(w,3))
 THEN RAISE EXCEPTION 'EXPIRED_META_WINDOW_CLAIMED'; END IF;
 UPDATE public.crm_wa_conversations SET last_inbound_at=clock_timestamp() WHERE id=conversation;
 SELECT * INTO wa_claim FROM public.automation_whatsapp_claim_reply(w,3);
 IF wa_claim.action_id<>wa_action OR NOT public.automation_whatsapp_reply_pre_send(w,
  wa_action,wa_claim.claim_token,conversation,'1322421900964911','diagnostico_inicio_v1')
 THEN RAISE EXCEPTION 'VALID_WA_REPLY_NOT_FENCED'; END IF;
 UPDATE public.crm_wa_conversations SET mode='human_locked' WHERE id=conversation;
 IF public.automation_whatsapp_reply_pre_send(w,wa_action,wa_claim.claim_token,
  conversation,'1322421900964911','diagnostico_inicio_v1')
 THEN RAISE EXCEPTION 'HUMAN_TAKEOVER_IGNORED'; END IF;
END $qa$;
ROLLBACK;
SELECT 'stage2-channel-executors-qa-passed' AS qa;
