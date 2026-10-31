-- REVIEW ONLY. Read-only canonical WhatsApp inbound -> shadow event journal.
-- Does NOT replace the existing whatsapp-webhook, AI SDR worker or Meta outbox.
BEGIN;
CREATE OR REPLACE FUNCTION public.automation_shadow_init_whatsapp_cursor(
 p_workspace_id uuid,p_actor_id uuid
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE v_time timestamptz;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.automation_workspace_members m
      JOIN public.crm_members crm ON crm.user_id=m.user_id
      JOIN public.automation_runtime_settings s ON s.workspace_id=m.workspace_id
      JOIN public.automation_workspaces w ON w.id=m.workspace_id
    WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id AND m.role='admin'
      AND s.mode='disabled' AND s.emergency_stop AND NOT w.active
  ) THEN RAISE EXCEPTION 'SHADOW_WA_BOOTSTRAP_NOT_AUTHORIZED' USING ERRCODE='42501'; END IF;
  INSERT INTO public.automation_ingest_cursors
    (workspace_id,source,last_occurred_at,initialized_by)
    VALUES(p_workspace_id,'whatsapp',clock_timestamp(),p_actor_id)
    ON CONFLICT(workspace_id,source) DO NOTHING;
  SELECT last_occurred_at INTO v_time
    FROM public.automation_ingest_cursors
    WHERE workspace_id=p_workspace_id AND source='whatsapp';
  RETURN v_time;
END; $$;

CREATE OR REPLACE FUNCTION public.automation_shadow_ingest_whatsapp(
 p_workspace_id uuid,p_batch_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE
  v_cursor public.automation_ingest_cursors%ROWTYPE;
  v_message RECORD;
  v_seen integer :=0;
  v_added integer :=0;
  v_inserted uuid;
BEGIN
  IF p_batch_limit IS NULL OR p_batch_limit NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'SHADOW_WA_BATCH_INVALID' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
    WHERE w.id=p_workspace_id AND w.active AND s.mode='shadow' AND NOT s.emergency_stop
  ) THEN RAISE EXCEPTION 'SHADOW_RUNTIME_DISABLED' USING ERRCODE='42501'; END IF;

  SELECT * INTO v_cursor FROM public.automation_ingest_cursors
    WHERE workspace_id=p_workspace_id AND source='whatsapp' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SHADOW_WA_CURSOR_UNINITIALIZED' USING ERRCODE='42501'; END IF;
  FOR v_message IN
    SELECT m.id,m.conversation_id,m.occurred_at
    FROM public.crm_wa_messages m
    WHERE (m.occurred_at,m.id)>(v_cursor.last_occurred_at,v_cursor.last_event_id)
      AND m.direction='inbound' AND m.conversation_id IS NOT NULL
      AND m.reaction_to_provider_message_id IS NULL
    ORDER BY m.occurred_at,m.id LIMIT p_batch_limit
  LOOP
    -- No message body or customer WhatsApp ID is copied into the event inbox.
    v_inserted:=NULL;
    INSERT INTO public.automation_event_inbox
      (workspace_id,source,event_id,event_type,schema_version,context_refs)
      VALUES(p_workspace_id,'whatsapp','wa:'||v_message.id::text,
        'conversation.inbound','1.0.0',
        jsonb_build_object('conversation_id',v_message.conversation_id::text))
      ON CONFLICT(workspace_id,source,event_id) DO NOTHING RETURNING id INTO v_inserted;
    IF v_inserted IS NOT NULL THEN v_added:=v_added+1; END IF;
    v_cursor.last_occurred_at:=v_message.occurred_at;
    v_cursor.last_event_id:=v_message.id;
    v_seen:=v_seen+1;
  END LOOP;
  IF v_seen>0 THEN
    UPDATE public.automation_ingest_cursors SET
      last_occurred_at=v_cursor.last_occurred_at,
      last_event_id=v_cursor.last_event_id,
      updated_at=now()
      WHERE workspace_id=p_workspace_id AND source='whatsapp';
  END IF;
  RETURN jsonb_build_object('shadowOnly',true,'dispatchAuthorized',false,
    'scanned',v_seen,'inserted',v_added,'hasMorePossible',v_seen=p_batch_limit);
END; $$;
REVOKE ALL ON FUNCTION public.automation_shadow_init_whatsapp_cursor(uuid,uuid)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_shadow_ingest_whatsapp(uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_shadow_init_whatsapp_cursor(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_shadow_ingest_whatsapp(uuid,integer) TO service_role;
COMMIT;
