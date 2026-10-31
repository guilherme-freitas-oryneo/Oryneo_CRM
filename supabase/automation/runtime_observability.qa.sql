-- Macro 6 observability in isolated PostgreSQL17, never contacts providers.
\set ON_ERROR_STOP on
\i supabase/automation/runtime_observability.preview.sql
DO $acl$
BEGIN
 IF has_table_privilege('anon','public.automation_runtime_metrics','SELECT')
 OR has_table_privilege('authenticated','public.automation_runtime_metrics','SELECT')
 OR has_function_privilege('authenticated',
   'public.automation_runtime_health(uuid)','EXECUTE')
 OR has_function_privilege('anon',
   'public.automation_metric_record(uuid,text,text,text,integer,integer,integer,bigint,text)','EXECUTE')
 THEN RAISE EXCEPTION 'RUNTIME_METRICS_UNSAFE_PRIVILEGES'; END IF;
END $acl$;
BEGIN;
SET ROLE service_role;
DO $qa$
DECLARE w uuid:='11111111-1111-4111-8111-111111111111';
 added boolean;health jsonb;denied boolean:=false;
BEGIN
 added:=public.automation_metric_record(w,'qa-macro6-unique','planner','completed',214);
 IF NOT added THEN RAISE EXCEPTION 'METRIC_NOT_RECORDED'; END IF;
 added:=public.automation_metric_record(w,'qa-macro6-unique','planner','failed',3);
 IF added THEN RAISE EXCEPTION 'METRIC_DUPLICATED'; END IF;
 health:=public.automation_runtime_health(w);
 IF (health->'lastHour'->>'count')::integer<1
  OR (health->'lastHour'->>'unknownCostCount')::integer<1
  OR health->'lastHour'->>'verifiedProviderCostMicrosUsd'<>'0'
 THEN RAISE EXCEPTION 'METRIC_HEALTH_BAD: %',health; END IF;
 BEGIN
  PERFORM public.automation_metric_record(w,'qa-macro6-invalid','planner','completed',1,
    NULL,NULL,100,'unknown');
 EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'UNVERIFIED_AI_COST_ACCEPTED'; END IF;
 IF (SELECT count(*) FROM public.automation_runtime_metrics
   WHERE workspace_id=w AND metric_key='qa-macro6-unique')<>1
 THEN RAISE EXCEPTION 'METRIC_IDEMPOTENCY_BROKEN'; END IF;
END $qa$;
RESET ROLE;
ROLLBACK;
SELECT 'macro6-observability-rls-no-pii-qa-passed' AS qa_result;
