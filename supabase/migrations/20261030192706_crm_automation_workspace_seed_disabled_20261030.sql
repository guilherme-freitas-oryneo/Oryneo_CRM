-- Applied to ORYNEO-CRM on 2026-10-30 (migration 20261030192706).
-- Initializes one disabled workspace and grants admin ONLY to the sole
-- CRM member with an existing global WhatsApp admin grant.
DO $$
DECLARE
  v_user uuid;
  v_workspace uuid;
  v_admin_count integer;
BEGIN
  SELECT count(*) INTO v_admin_count FROM (
    SELECT DISTINCT m.user_id FROM public.crm_members m
    JOIN public.crm_wa_access a ON a.user_id=m.user_id
    WHERE a.role='admin' AND a.conversation_id IS NULL
  ) eligible_admins;
  IF v_admin_count<>1 OR (SELECT count(*) FROM public.crm_members)<>1 THEN
    RAISE EXCEPTION 'AUTOMATION_BOOTSTRAP_UNSAFE_ADMIN_CARDINALITY' USING ERRCODE='42501';
  END IF;
  SELECT m.user_id INTO STRICT v_user
    FROM public.crm_members m JOIN public.crm_wa_access a ON a.user_id=m.user_id
    WHERE a.role='admin' AND a.conversation_id IS NULL LIMIT 1;
  INSERT INTO public.automation_workspaces(slug,active)
    VALUES('oryneo-crm',false) ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO v_workspace FROM public.automation_workspaces
    WHERE slug='oryneo-crm' AND active=false;
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'AUTOMATION_BOOTSTRAP_WORKSPACE_STATE_MISMATCH' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.automation_workspace_members(workspace_id,user_id,role,granted_by)
    VALUES(v_workspace,v_user,'admin',v_user)
    ON CONFLICT (workspace_id,user_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.automation_workspace_members
    WHERE workspace_id=v_workspace AND user_id=v_user AND role='admin') THEN
    RAISE EXCEPTION 'AUTOMATION_BOOTSTRAP_ADMIN_GRANT_FAILED' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.automation_runtime_settings(workspace_id,mode,emergency_stop,updated_by)
    VALUES(v_workspace,'disabled',true,v_user)
    ON CONFLICT (workspace_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.automation_runtime_settings
    WHERE workspace_id=v_workspace AND mode='disabled' AND emergency_stop=true) THEN
    RAISE EXCEPTION 'AUTOMATION_BOOTSTRAP_RUNTIME_NOT_DISABLED' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
    VALUES(v_workspace,v_user,'workspace_bootstrapped','workspace',v_workspace,
      '{"automation_dispatch":"disabled","preserve_existing_sdr":true}'::jsonb);
END; $$;