-- Edge Functions use the service role, which bypasses RLS but still needs
-- explicit table privileges after the public-role revokes in the base migration.
grant select, insert, update on table public.crm_billing_orders to service_role;
grant select, insert, update on table public.crm_stripe_events to service_role;
