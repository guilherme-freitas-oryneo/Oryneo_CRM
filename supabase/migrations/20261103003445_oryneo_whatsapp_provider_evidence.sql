-- Records the verified WhatsApp provider identity observed in Meta for the
-- existing active CRM channel.  This is evidence only: the new engine remains
-- disabled and legacy delivery remains the sole live owner.
BEGIN;

DO $migration$
DECLARE
  v_workspace_id uuid;
  v_admin_id uuid;
  v_binding_count integer;
  v_binding_id uuid;
BEGIN
  SELECT w.id
    INTO v_workspace_id
    FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings runtime
      ON runtime.workspace_id = w.id
   WHERE w.slug = 'oryneo-crm'
     AND w.active = true
     AND runtime.mode = 'shadow'
     AND runtime.emergency_stop = false;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'ORYNEO_WHATSAPP_WORKSPACE_NOT_IN_SAFE_SHADOW_STATE';
  END IF;

  SELECT m.user_id
    INTO v_admin_id
    FROM public.automation_workspace_members m
   WHERE m.workspace_id = v_workspace_id
     AND m.role = 'admin'
   ORDER BY m.user_id
   LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'ORYNEO_WHATSAPP_ADMIN_NOT_FOUND';
  END IF;

  SELECT count(*)
    INTO v_binding_count
    FROM public.automation_whatsapp_provider_bindings b
    JOIN public.crm_wa_channels channel
      ON channel.id = b.crm_channel_id
   WHERE b.workspace_id = v_workspace_id
     AND channel.enabled = true
     AND b.messaging_account_id = channel.messaging_account_id
     AND b.phone_number_id = channel.phone_number_id;

  IF v_binding_count <> 1 THEN
    RAISE EXCEPTION 'ORYNEO_WHATSAPP_PROVIDER_MATCH_COUNT_INVALID: %', v_binding_count;
  END IF;

  SELECT b.crm_channel_id
    INTO v_binding_id
    FROM public.automation_whatsapp_provider_bindings b
    JOIN public.crm_wa_channels channel
      ON channel.id = b.crm_channel_id
   WHERE b.workspace_id = v_workspace_id
     AND channel.enabled = true
     AND b.messaging_account_id = channel.messaging_account_id
     AND b.phone_number_id = channel.phone_number_id;

  UPDATE public.automation_whatsapp_provider_bindings
     SET verified_by = v_admin_id,
         verified_at = COALESCE(verified_at, clock_timestamp()),
         -- Provider evidence alone cannot grant a live cutover.
         enabled = false,
         release_approved_by = NULL,
         release_approved_at = NULL,
         updated_at = clock_timestamp()
   WHERE workspace_id = v_workspace_id
     AND crm_channel_id = v_binding_id;

  INSERT INTO public.automation_audit_log(
    workspace_id, actor_id, action, target_type, target_id, summary
  ) VALUES (
    v_workspace_id,
    v_admin_id,
    'whatsapp_provider_identity_verified_shadow',
    'crm_wa_channel',
    v_binding_id,
    jsonb_build_object(
      'verified_in', 'meta_business_configuration',
      'new_engine_enabled', false,
      'legacy_dispatch_changed', false
    )
  );
END
$migration$;

COMMIT;
