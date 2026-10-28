-- The billing Edge Function validates the authenticated CRM member through
-- PostgREST. RLS bypass does not replace the underlying table privilege.
grant select on table public.crm_members to service_role;
