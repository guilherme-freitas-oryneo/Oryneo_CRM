-- ORYNEO macro 6 — atomic Meta provider receipt and CRM timeline, REVIEW ONLY.
-- No provider request is made by this SQL. An accepted provider id is
-- mandatory; a stale lease never acquires receipt ownership.
BEGIN;
CREATE OR REPLACE FUNCTION public.automation_meta_template_receipt(
 p_workspace_id uuid,p_action_id uuid,p_claim_token uuid,
 p_provider_message_id text,p_rendered_body text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE
 action public.automation_action_outbox%ROWTYPE;
 convo_id uuid; stored_convo uuid;
BEGIN
 IF p_workspace_id IS NULL OR p_action_id IS NULL OR p_claim_token IS NULL
  OR p_provider_message_id IS NULL
  OR length(p_provider_message_id) NOT BETWEEN 3 AND 512
  OR p_provider_message_id !~ '^[A-Za-z0-9_.:/=-]+$'
  OR p_rendered_body IS NULL OR length(trim(p_rendered_body))=0
  OR length(p_rendered_body)>4096
 THEN RAISE EXCEPTION 'META_RECEIPT_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO action FROM public.automation_action_outbox
 WHERE id=p_action_id AND workspace_id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR action.action_type<>'whatsapp_template'
  OR action.claim_token IS DISTINCT FROM p_claim_token
 THEN RAISE EXCEPTION 'META_RECEIPT_LEASE_STALE' USING ERRCODE='42501'; END IF;
 IF action.state='sent' AND action.provider_result_id=p_provider_message_id
 THEN RETURN jsonb_build_object('ok',true,'alreadyRecorded',true,'dispatchAuthorized',false); END IF;
 IF action.state NOT IN ('leased','uncertain')
 THEN RAISE EXCEPTION 'META_RECEIPT_STATE_INVALID' USING ERRCODE='42501'; END IF;
 SELECT conv.id INTO convo_id
 FROM public.automation_executions ex
 JOIN public.automation_event_inbox inbox ON inbox.id=ex.inbox_id
  AND inbox.workspace_id=ex.workspace_id
 JOIN public.crm_wa_conversations conv ON conv.id=CASE WHEN
   (inbox.context_refs->>'conversation_id') ~*
   '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   THEN (inbox.context_refs->>'conversation_id')::uuid ELSE NULL END
 WHERE ex.id=action.execution_id AND ex.workspace_id=p_workspace_id;
 IF convo_id IS NULL THEN RAISE EXCEPTION 'META_RECEIPT_CONVERSATION_UNBOUND' USING ERRCODE='42501'; END IF;
 SELECT conversation_id INTO stored_convo FROM public.crm_wa_messages
 WHERE provider_message_id=p_provider_message_id;
 IF stored_convo IS NOT NULL AND stored_convo<>convo_id
 THEN RAISE EXCEPTION 'META_PROVIDER_RECEIPT_COLLISION' USING ERRCODE='23505'; END IF;
 -- Receipt and read-model change are ONE database transaction.
 INSERT INTO public.crm_wa_messages(conversation_id,provider_message_id,
  direction,kind,body,occurred_at,delivery_status)
 VALUES(convo_id,p_provider_message_id,'outbound','text',
  p_rendered_body,clock_timestamp(),'pending')
 ON CONFLICT(provider_message_id) DO NOTHING;
 UPDATE public.automation_action_outbox
 SET state='sent',provider_result_id=p_provider_message_id,
  result_code='META_PROVIDER_ACCEPTED',reconciled_at=clock_timestamp(),
  lease_until=NULL
 WHERE id=action.id AND claim_token=p_claim_token;
 UPDATE public.crm_wa_conversations
 SET last_preview=left(p_rendered_body,160),
  last_message_at=greatest(coalesce(last_message_at,clock_timestamp()),clock_timestamp()),
  updated_at=clock_timestamp()
 WHERE id=convo_id;
 RETURN jsonb_build_object('ok',true,'receiptStored',true,'dispatchAuthorized',false);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_meta_template_receipt(uuid,uuid,uuid,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_meta_template_receipt(uuid,uuid,uuid,text,text)
 TO service_role;
COMMIT;
