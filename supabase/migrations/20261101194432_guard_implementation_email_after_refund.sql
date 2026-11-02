-- Revalidate the canonical order when the legacy mail job is claimed.
-- This leaves intake email behavior unchanged and does not create a new job.
-- A payment reversal before claim must not start an implementation email.
CREATE OR REPLACE FUNCTION public.crm_claim_intake_confirmation_jobs(p_limit integer DEFAULT 10)
RETURNS TABLE(request_id uuid, deal_id uuid, data jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF p_limit NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION 'Limite inválido.' USING ERRCODE='22023';
  END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT job.id FROM public.crm_automation_jobs job
    WHERE job.attempts<5 AND job.due_at<=now()
      AND job.state IN ('scheduled','failed')
      AND (job.job_type<>'implementation_started_email' OR EXISTS (
        SELECT 1 FROM public.crm_billing_orders bill
        WHERE bill.deal_id=job.deal_id AND bill.status='paid'
          AND bill.paid_at IS NOT NULL AND bill.billing_environment='live'
      ))
    ORDER BY job.due_at,job.id FOR UPDATE SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.crm_automation_jobs job
    SET state='running',attempts=job.attempts+1,error_code=NULL,
        updated_at=clock_timestamp()
    FROM candidates WHERE job.id=candidates.id
    RETURNING job.id,job.deal_id,job.job_type
  )
  SELECT claimed.id,claimed.deal_id,
    jsonb_set(rec.data,'{_automation_job_type}',to_jsonb(claimed.job_type),true)
  FROM claimed JOIN public.crm_records rec ON rec.id=claimed.deal_id
    AND rec.kind='deal' AND NOT rec.deleted;
END $function$;

REVOKE ALL ON FUNCTION public.crm_claim_intake_confirmation_jobs(integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_claim_intake_confirmation_jobs(integer)
  TO service_role;
