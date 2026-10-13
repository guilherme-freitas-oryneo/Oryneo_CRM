-- mail-api derives first-contact recipients and content from the canonical deal.
-- Keep mutations behind the existing service-only RPC.
grant select on table public.crm_records to service_role;
