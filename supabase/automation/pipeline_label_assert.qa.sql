-- Verify no duplicated stages, no moved deals and no semantic regression.
\set ON_ERROR_STOP on
DO $$
BEGIN
 IF (SELECT count(*) FROM public.crm_records WHERE kind='stage' AND NOT deleted)<>4
 THEN RAISE EXCEPTION 'Stage count changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_records WHERE id='8e200e46-92db-4419-b752-11ab089fd5a3'
   AND data->>'name'='Diagnóstico concluído' AND revision=3
   AND data->>'color'='#123456' AND data->>'position'='3000')
 OR NOT EXISTS(SELECT 1 FROM public.crm_records WHERE id='f883a26d-d813-4d09-b807-fa1eb44396f4'
   AND data->>'name'='Aguardando decisão' AND revision=3
   AND data->>'outcome'='open') THEN
 RAISE EXCEPTION 'Canonical stage identity or revision altered'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_records WHERE id='a623469a-34c8-4c21-9a44-7e20cc7df502'
  AND data->>'name'='Implantação' AND data->>'outcome'='won' AND revision=1)
 OR NOT EXISTS(SELECT 1 FROM public.crm_records WHERE id='6ab321bd-5ec4-4dfc-b8c0-4824da854273'
  AND data->>'name'='Ganha' AND data->>'outcome'='won') THEN
 RAISE EXCEPTION 'Won/implementation legacy semantics changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.crm_records WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'
   AND revision=9 AND data->>'stage_id'='8e200e46-92db-4419-b752-11ab089fd5a3') THEN
 RAISE EXCEPTION 'Existing deal moved or revised'; END IF;
 IF (SELECT count(*) FROM public.automation_audit_log WHERE action='pipeline_stage_renamed')<>2
 THEN RAISE EXCEPTION 'Stage rename missing or duplicated audit'; END IF;
END; $$;
SELECT 'stage-renames-idempotent-and-preserved' AS qa_status;
