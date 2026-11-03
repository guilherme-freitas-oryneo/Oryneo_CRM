-- Records the workspace administrator's instruction to complete the rollout.
-- This is intentionally distinct from a release attestation: each technical,
-- provider and recipient-level proof remains independently required.
BEGIN;

DO $migration$
DECLARE
  v_workspace_id uuid;
  v_admin_id uuid;
BEGIN
  SELECT w.id
    INTO v_workspace_id
    FROM public.automation_workspaces w
   WHERE w.slug = 'oryneo-crm'
     AND w.active = true;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'ORYNEO_AUTOMATION_WORKSPACE_NOT_ACTIVE';
  END IF;

  SELECT m.user_id
    INTO v_admin_id
    FROM public.automation_workspace_members m
   WHERE m.workspace_id = v_workspace_id
     AND m.role = 'admin'
   ORDER BY m.user_id
   LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'ORYNEO_AUTOMATION_ADMIN_NOT_FOUND';
  END IF;

  INSERT INTO public.automation_audit_log(
    workspace_id, actor_id, action, target_type, target_id, summary
  )
  SELECT
    v_workspace_id,
    v_admin_id,
    'operator_release_authorization_recorded',
    'automation_workspace',
    v_workspace_id,
    jsonb_build_object(
      'all_channels_requested', true,
      'authorization_scope', 'implementation_and_controlled_rollout',
      'release_attestation_created', false,
      'recipient_consent_inferred', false,
      'legacy_owner_changed', false
    )
  WHERE NOT EXISTS (
    SELECT 1
      FROM public.automation_audit_log existing
     WHERE existing.workspace_id = v_workspace_id
       AND existing.action = 'operator_release_authorization_recorded'
  );
END
$migration$;

COMMIT;
