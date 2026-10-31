-- ORYNEO post-sale transition PREVIEW (isolated QA only).
-- Reuses the existing CRM delivery projects/milestones and the legacy email job.
-- Does not replace, disable or drop the legacy stage trigger.
-- Does not directly invoke SMTP, WhatsApp or Stripe.
BEGIN;
CREATE OR REPLACE FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
DECLARE
 v_deal_id uuid;
 v_rows integer := 0;
BEGIN
  -- A distinct, explicit release gate prevents a second e-mail owner during
  -- migration. Disabled/shadow and emergency-stop modes NEVER queue here.
  IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings st ON st.workspace_id=w.id
    WHERE w.slug='oryneo-crm' AND w.active
      AND st.mode='live' AND st.emergency_stop=false)
  THEN RETURN NEW; END IF;
  -- A sandbox payment, unpaid order or missing paid_at NEVER queues an email.
  SELECT o.deal_id INTO v_deal_id
    FROM public.crm_billing_orders o
    WHERE o.id=NEW.order_id AND o.status='paid'
      AND o.paid_at IS NOT NULL AND o.billing_environment='live';
  IF v_deal_id IS NULL THEN RETURN NEW; END IF;
  -- The existing unique (deal_id,job_type) index for legacy jobs ensures
  -- the old stage transition cannot create a duplicate message.
  INSERT INTO public.crm_automation_jobs(deal_id,job_type,due_at)
    VALUES(v_deal_id,'implementation_started_email',clock_timestamp()+interval '5 minutes')
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows=1 THEN
    INSERT INTO public.crm_delivery_audit(order_id,action,detail)
      VALUES(NEW.order_id,'implementation_email_queued',
        '{"origin":"verified_live_paid_order","legacy_job_deduplicated":true}'::jsonb);
  END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery()
  FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS automation_queue_implementation_on_paid_delivery ON public.crm_delivery_projects;
CREATE TRIGGER automation_queue_implementation_on_paid_delivery
  AFTER INSERT ON public.crm_delivery_projects
  FOR EACH ROW EXECUTE FUNCTION public.automation_enqueue_legacy_implementation_on_paid_delivery();
COMMIT;
