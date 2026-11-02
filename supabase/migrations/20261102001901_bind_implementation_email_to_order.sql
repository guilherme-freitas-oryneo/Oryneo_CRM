-- Bind every implementation e-mail to the exact live billing order that
-- authorized it. Existing lead e-mails keep their legacy subject shape.
-- This migration is additive and keeps the current outbox/idempotency path.

CREATE INDEX IF NOT EXISTS crm_automation_jobs_active_implementation_order
  ON public.crm_automation_jobs(subject_id)
  WHERE job_type='implementation_started_email'
    AND state IN ('scheduled','failed','reconciliation','running');

WITH bindable AS (
  SELECT job.id,(
    SELECT bill.id
    FROM public.crm_billing_orders bill
    WHERE bill.deal_id=job.deal_id
      AND bill.status='paid'
      AND bill.paid_at IS NOT NULL
      AND bill.billing_environment='live'
    ORDER BY bill.paid_at DESC,bill.created_at DESC,bill.id DESC
    LIMIT 1
  ) AS order_id
  FROM public.crm_automation_jobs job
  WHERE job.job_type='implementation_started_email'
    AND job.subject_type IS NULL
    AND job.state IN ('scheduled','failed','reconciliation')
)
UPDATE public.crm_automation_jobs job
SET subject_type='billing_order',subject_id=bindable.order_id,
    occurrence_key='implementation_started',updated_at=clock_timestamp()
FROM bindable
WHERE job.id=bindable.id AND bindable.order_id IS NOT NULL;

UPDATE public.crm_automation_jobs job
SET state='suppressed',error_code='IMPLEMENTATION_ORDER_INVALID',
    completed_at=clock_timestamp(),updated_at=clock_timestamp()
WHERE job.job_type='implementation_started_email'
  AND job.state IN ('scheduled','failed','reconciliation')
  AND (job.subject_type IS DISTINCT FROM 'billing_order'
    OR job.subject_id IS NULL
    OR job.occurrence_key IS DISTINCT FROM 'implementation_started');

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
    SELECT job.id
    FROM public.crm_automation_jobs job
    WHERE job.attempts<5 AND job.due_at<=now()
      AND job.state IN ('scheduled','failed')
      AND (
        job.job_type<>'implementation_started_email'
        OR (
          job.subject_type='billing_order'
          AND job.subject_id IS NOT NULL
          AND job.occurrence_key='implementation_started'
          AND EXISTS (
            SELECT 1
            FROM public.crm_billing_orders bill
            WHERE bill.id=job.subject_id
              AND bill.deal_id=job.deal_id
              AND bill.status='paid'
              AND bill.paid_at IS NOT NULL
              AND bill.billing_environment='live'
          )
        )
      )
    ORDER BY job.due_at,job.id
    FOR UPDATE OF job SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.crm_automation_jobs job
    SET state='running',attempts=job.attempts+1,error_code=NULL,
        updated_at=clock_timestamp()
    FROM candidates
    WHERE job.id=candidates.id
    RETURNING job.id,job.deal_id,job.job_type,job.subject_id
  )
  SELECT claimed.id,claimed.deal_id,
    jsonb_set(
      jsonb_set(rec.data,'{_automation_job_type}',to_jsonb(claimed.job_type),true),
      '{_automation_order_id}',coalesce(to_jsonb(claimed.subject_id),'null'::jsonb),true
    )
  FROM claimed
  JOIN public.crm_records rec ON rec.id=claimed.deal_id
    AND rec.kind='deal' AND NOT rec.deleted;
END
$function$;

REVOKE ALL ON FUNCTION public.crm_claim_intake_confirmation_jobs(integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_claim_intake_confirmation_jobs(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.crm_schedule_implementation_automation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_order_id uuid;
BEGIN
  IF new.kind='deal' AND NOT new.deleted
     AND new.data->>'stage_id'='a623469a-34c8-4c21-9a44-7e20cc7df502'
     AND old.data->>'stage_id' IS DISTINCT FROM new.data->>'stage_id' THEN
    SELECT bill.id INTO v_order_id
    FROM public.crm_billing_orders bill
    WHERE bill.deal_id=new.id
      AND bill.status='paid'
      AND bill.paid_at IS NOT NULL
      AND bill.billing_environment='live'
    ORDER BY bill.paid_at DESC,bill.created_at DESC,bill.id DESC
    LIMIT 1;
    IF v_order_id IS NOT NULL THEN
      INSERT INTO public.crm_automation_jobs(
        deal_id,job_type,due_at,subject_type,subject_id,occurrence_key
      ) VALUES (
        new.id,'implementation_started_email',clock_timestamp()+interval '5 minutes',
        'billing_order',v_order_id,'implementation_started'
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION public.crm_schedule_implementation_automation()
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $function$
DECLARE
  v_deal_id uuid;
  v_rows integer := 0;
BEGIN
  IF NOT EXISTS(
    SELECT 1
    FROM public.automation_workspaces workspace
    JOIN public.automation_runtime_settings settings
      ON settings.workspace_id=workspace.id
    WHERE workspace.slug='oryneo-crm' AND workspace.active
      AND settings.mode='live' AND settings.emergency_stop=false
  ) THEN
    RETURN new;
  END IF;
  SELECT bill.deal_id INTO v_deal_id
  FROM public.crm_billing_orders bill
  WHERE bill.id=new.order_id
    AND bill.status='paid'
    AND bill.paid_at IS NOT NULL
    AND bill.billing_environment='live';
  IF v_deal_id IS NULL THEN
    RETURN new;
  END IF;
  INSERT INTO public.crm_automation_jobs(
    deal_id,job_type,due_at,subject_type,subject_id,occurrence_key
  ) VALUES (
    v_deal_id,'implementation_started_email',clock_timestamp()+interval '5 minutes',
    'billing_order',new.order_id,'implementation_started'
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows=1 THEN
    INSERT INTO public.crm_delivery_audit(order_id,action,detail)
    VALUES(new.order_id,'implementation_email_queued',
      '{"origin":"verified_live_paid_order","exact_order_bound":true}'::jsonb);
  END IF;
  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery()
  FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.crm_suppress_implementation_email_on_payment_reversal()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF old.status='paid' AND old.paid_at IS NOT NULL
     AND old.billing_environment='live'
     AND (
       new.status IS DISTINCT FROM 'paid'
       OR new.paid_at IS NULL
       OR new.billing_environment IS DISTINCT FROM 'live'
     ) THEN
    UPDATE public.crm_automation_jobs job
    SET state='suppressed',error_code='IMPLEMENTATION_PAYMENT_REVOKED',
        completed_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE job.job_type='implementation_started_email'
      AND job.subject_type='billing_order'
      AND job.subject_id=new.id
      AND job.state IN ('scheduled','failed','reconciliation');
  END IF;
  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION public.crm_suppress_implementation_email_on_payment_reversal()
  FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS crm_suppress_implementation_email_on_payment_reversal
  ON public.crm_billing_orders;
CREATE TRIGGER crm_suppress_implementation_email_on_payment_reversal
AFTER UPDATE OF status,paid_at,billing_environment ON public.crm_billing_orders
FOR EACH ROW
EXECUTE FUNCTION public.crm_suppress_implementation_email_on_payment_reversal();
