-- The shadow commercial adapter is SECURITY INVOKER and reads only the
-- canonical source view. These explicit SELECT grants let service_role read
-- the view's sources without granting write access or changing RLS policies.
BEGIN;

GRANT SELECT ON TABLE
  public.crm_intake_requests,
  public.crm_billing_orders,
  public.crm_stripe_events,
  public.crm_events,
  public.crm_proposals,
  public.crm_wa_automation_events,
  public.crm_delivery_projects
TO service_role;

COMMIT;
