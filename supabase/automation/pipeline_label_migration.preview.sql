-- REVIEW-ONLY MIGRATION. Use a disposable DB in CI before considering release.
-- Renames two canonical stage records IN PLACE: no new IDs, no deal moves,
-- no deletion, no modified outcomes, no changes to the legacy Implantação ID.
BEGIN;
DO $$
DECLARE
  v_one uuid := '8e200e46-92db-4419-b752-11ab089fd5a3';
  v_two uuid := 'f883a26d-d813-4d09-b807-fa1eb44396f4';
  v_old_one text;
  v_old_two text;
  v_rev_one bigint;
  v_rev_two bigint;
  v_changed integer := 0;
  v_ws uuid;
BEGIN
  -- Serialize with all stage-name changes and fail on unexpected state.
  SELECT data->>'name',revision INTO v_old_one,v_rev_one
    FROM public.crm_records WHERE id=v_one AND kind='stage' AND NOT deleted FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXPECTED_STAGE_ONE_MISSING' USING ERRCODE='P0002'; END IF;
  SELECT data->>'name',revision INTO v_old_two,v_rev_two
    FROM public.crm_records WHERE id=v_two AND kind='stage' AND NOT deleted FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'EXPECTED_STAGE_TWO_MISSING' USING ERRCODE='P0002'; END IF;
  IF v_old_one NOT IN ('Qualificada','Diagnóstico concluído')
    OR v_old_two NOT IN ('Em decisão','Aguardando decisão') THEN
    RAISE EXCEPTION 'STAGE_LABEL_DRIFT' USING ERRCODE='40001';
  END IF;

  SELECT id INTO v_ws FROM public.automation_workspaces WHERE slug='oryneo-crm';
  IF v_ws IS NULL THEN RAISE EXCEPTION 'AUTOMATION_WORKSPACE_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_old_one='Qualificada' THEN
    UPDATE public.crm_records SET
      data=jsonb_set(data,'{name}',to_jsonb('Diagnóstico concluído'::text),false),
      revision=revision+1 WHERE id=v_one AND revision=v_rev_one AND data->>'name'='Qualificada';
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed<>1 THEN RAISE EXCEPTION 'STAGE_RENAME_CAS_FAILED' USING ERRCODE='40001'; END IF;
    INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
      VALUES(v_ws,NULL,'pipeline_stage_renamed','crm_stage',v_one,
        '{"old":"Qualificada","new":"Diagnóstico concluído","preserve_id":true}'::jsonb);
  END IF;
  IF v_old_two='Em decisão' THEN
    UPDATE public.crm_records SET
      data=jsonb_set(data,'{name}',to_jsonb('Aguardando decisão'::text),false),
      revision=revision+1 WHERE id=v_two AND revision=v_rev_two AND data->>'name'='Em decisão';
    GET DIAGNOSTICS v_changed=ROW_COUNT;
    IF v_changed<>1 THEN RAISE EXCEPTION 'STAGE_RENAME_CAS_FAILED' USING ERRCODE='40001'; END IF;
    INSERT INTO public.automation_audit_log(workspace_id,actor_id,action,target_type,target_id,summary)
      VALUES(v_ws,NULL,'pipeline_stage_renamed','crm_stage',v_two,
        '{"old":"Em decisão","new":"Aguardando decisão","preserve_id":true}'::jsonb);
  END IF;
  -- Postcondition holds even when migration is rerun, without a new revision.
  IF NOT EXISTS(SELECT 1 FROM public.crm_records WHERE id=v_one AND kind='stage'
    AND NOT deleted AND data->>'name'='Diagnóstico concluído' AND data->>'outcome'='open')
    OR NOT EXISTS(SELECT 1 FROM public.crm_records WHERE id=v_two AND kind='stage'
    AND NOT deleted AND data->>'name'='Aguardando decisão' AND data->>'outcome'='open') THEN
    RAISE EXCEPTION 'STAGE_POSTCONDITION_FAILED' USING ERRCODE='23514';
  END IF;
END; $$;
COMMIT;
