-- ORYNEO macro 6: bounded, idempotent, PII-free latency/usage evidence.
-- CI PREVIEW ONLY. This does not activate the engine, providers or billing.
BEGIN;
CREATE TABLE IF NOT EXISTS public.automation_runtime_metrics(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 metric_key text NOT NULL CHECK(metric_key ~ '^[a-zA-Z0-9_.:-]{8,160}$'),
 category text NOT NULL CHECK(category IN('planner','crm_action','whatsapp','email','sdr_ai')),
 outcome text NOT NULL CHECK(outcome IN('completed','blocked','failed','uncertain','quarantined')),
 duration_ms integer NOT NULL CHECK(duration_ms BETWEEN 0 AND 600000),
 input_tokens integer CHECK(input_tokens BETWEEN 0 AND 1000000),
 output_tokens integer CHECK(output_tokens BETWEEN 0 AND 1000000),
 provider_cost_micros_usd bigint CHECK(provider_cost_micros_usd BETWEEN 0 AND 100000000000),
 provider_cost_source text NOT NULL DEFAULT 'unknown'
   CHECK(provider_cost_source IN('unknown','verified_provider_report')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,metric_key),
 CONSTRAINT automation_metering_cost_provenance CHECK (
  (provider_cost_source='unknown' AND provider_cost_micros_usd IS NULL)
  OR (provider_cost_source='verified_provider_report'
      AND provider_cost_micros_usd IS NOT NULL))
);
ALTER TABLE public.automation_runtime_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_runtime_metrics FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.automation_runtime_metrics TO service_role;
CREATE INDEX IF NOT EXISTS automation_runtime_metrics_time_idx
 ON public.automation_runtime_metrics(workspace_id,occurred_at DESC);

CREATE OR REPLACE FUNCTION public.automation_metric_record(
 p_workspace_id uuid,p_key text,p_category text,p_outcome text,p_duration_ms integer,
 p_input_tokens integer DEFAULT NULL,p_output_tokens integer DEFAULT NULL,
 p_cost_micros_usd bigint DEFAULT NULL,p_cost_source text DEFAULT 'unknown'
) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE inserted uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces WHERE id=p_workspace_id)
 THEN RAISE EXCEPTION 'METRIC_WORKSPACE_UNKNOWN' USING ERRCODE='42501'; END IF;
 INSERT INTO public.automation_runtime_metrics(
  workspace_id,metric_key,category,outcome,duration_ms,input_tokens,
  output_tokens,provider_cost_micros_usd,provider_cost_source
 ) VALUES(
  p_workspace_id,p_key,p_category,p_outcome,p_duration_ms,p_input_tokens,
  p_output_tokens,p_cost_micros_usd,p_cost_source
 ) ON CONFLICT(workspace_id,metric_key) DO NOTHING RETURNING id INTO inserted;
 RETURN inserted IS NOT NULL;
END $fn$;

CREATE OR REPLACE FUNCTION public.automation_runtime_health(
 p_workspace_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE result jsonb;
BEGIN
 IF p_workspace_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM public.automation_workspaces WHERE id=p_workspace_id)
 THEN RAISE EXCEPTION 'RUNTIME_HEALTH_WORKSPACE_UNKNOWN' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
  'workspaceId',p_workspace_id,
  'runtime',(SELECT jsonb_build_object('mode',s.mode,'emergencyStop',s.emergency_stop)
      FROM public.automation_runtime_settings s WHERE s.workspace_id=p_workspace_id),
  'inbox',(SELECT jsonb_object_agg(state,c) FROM (
     SELECT state,count(*) c FROM public.automation_event_inbox
     WHERE workspace_id=p_workspace_id GROUP BY state) t),
  'outbox',(SELECT jsonb_object_agg(state,c) FROM (
     SELECT state,count(*) c FROM public.automation_action_outbox
     WHERE workspace_id=p_workspace_id GROUP BY state) t),
  'leasesExpired',(SELECT count(*) FROM public.automation_action_outbox
     WHERE workspace_id=p_workspace_id AND state='leased' AND lease_until<clock_timestamp()),
  'uncertain',(SELECT count(*) FROM public.automation_action_outbox
     WHERE workspace_id=p_workspace_id AND state='uncertain'),
  'lastHour',(SELECT jsonb_build_object(
     'count',count(*),
     'p95Ms',coalesce(percentile_disc(0.95) within group(order by duration_ms),0),
     'verifiedProviderCostMicrosUsd',coalesce(sum(provider_cost_micros_usd)
       FILTER(WHERE provider_cost_source='verified_provider_report'),0),
     'unknownCostCount',count(*) FILTER(WHERE provider_cost_source='unknown'))
     FROM public.automation_runtime_metrics
     WHERE workspace_id=p_workspace_id AND occurred_at>=clock_timestamp()-interval '1 hour')
 ) INTO result;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.automation_metric_record(uuid,text,text,text,integer,integer,integer,bigint,text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_runtime_health(uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_metric_record(uuid,text,text,text,integer,integer,integer,bigint,text)
 TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_runtime_health(uuid) TO service_role;