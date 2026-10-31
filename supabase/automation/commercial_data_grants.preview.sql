-- ORYNEO Stage 3 — release-time least-privilege grants for a service-side
-- automation worker. PREVIEW ONLY. Applied exclusively to PostgreSQL QA.
-- These grants DO NOT bypass other action fences, nor expose tables to clients.
-- Real hosted installation requires review of current ACLs/ownership and RLS.
BEGIN;
-- Canonical source feed uses a SECURITY INVOKER VIEW. It cannot observe a
-- table unless the service worker has an explicit SELECT grant.
GRANT SELECT ON TABLE public.crm_intake_requests,
 public.crm_events, public.crm_delivery_projects TO service_role;
-- Existing CRM worker uses SECURITY INVOKER RPCs, which otherwise fail with
-- permission denied after validating the immutable snapshot and lease.
-- Grant only fields already mutated by the legacy revision-controlled CRM.
GRANT SELECT ON public.crm_records,public.crm_history TO service_role;
GRANT INSERT ON public.crm_history,public.crm_events TO service_role;
GRANT UPDATE(data,revision,updated_at) ON public.crm_records TO service_role;
COMMIT;
