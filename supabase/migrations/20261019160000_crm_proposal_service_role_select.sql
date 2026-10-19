-- Edge Functions proposal-public and billing-create-order use the service role to read
-- the immutable, token-addressed proposal record. The original proposal migration
-- granted read only to authenticated CRM users and revoked PUBLIC privileges;
-- RLS BYPASS does not replace the table-level SELECT grant (PostgreSQL 42501).
--
-- Do not grant SELECT to anon or PUBLIC: the public proposal remains readable
-- only through the token-validated proposal-public Edge Function.
grant select on table public.crm_proposals to service_role;
