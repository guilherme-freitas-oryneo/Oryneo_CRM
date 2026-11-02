-- ORYNEO / Pipeline -> Pós-venda: diagnóstico RESTRITO À LEITURA.
-- Safe to execute with read-only privileges. This is NOT a migration.
-- A green value here does NOT authorize deployment or ownership changes.
-- Compare output with current source/cron triggers and approval documents.
WITH stage AS (
 SELECT id,data->>'name' name,data->>'outcome' outcome
 FROM public.crm_records WHERE kind='stage' AND deleted=false
), legacy AS (
 SELECT id FROM stage
 WHERE id='a623469a-34c8-4c21-9a44-7e20cc7df502'::uuid
), existing AS (
 SELECT count(*)::int AS active_legacy_deals FROM public.crm_records
 WHERE kind='deal' AND deleted=false
  AND data->>'stage_id'='a623469a-34c8-4c21-9a44-7e20cc7df502'
), functions AS (
 SELECT count(*)::int AS hardcoded_function_references FROM pg_catalog.pg_proc p
 JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public'
  AND p.prosrc ILIKE '%a623469a-34c8-4c21-9a44-7e20cc7df502%'
), won AS (
 SELECT count(*)::int AS won_stage_count,
 count(*) FILTER(WHERE name='Ganha')::int AS explicit_won_count
 FROM stage WHERE outcome='won'
)
SELECT
  EXISTS(SELECT 1 FROM legacy) AS legacy_stage_present,
  existing.active_legacy_deals,
  functions.hardcoded_function_references,
  won.won_stage_count,
  won.explicit_won_count,
  (SELECT count(*)::int FROM public.crm_delivery_projects) AS delivery_project_count,
  false AS migration_authorized,
  CASE
    WHEN existing.active_legacy_deals>0 THEN 'BLOCKED_HISTORICAL_DEALS'
    WHEN functions.hardcoded_function_references>0 THEN 'BLOCKED_LEGACY_TRIGGER_REFERENCES'
    WHEN won.explicit_won_count<>1 THEN 'BLOCKED_CANONICAL_WIN_AMBIGUOUS'
    ELSE 'NEEDS_BRIDGE_ROLLBACK_AND_APPROVAL'
  END AS transition_readiness
FROM existing,functions,won;
