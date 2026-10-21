# ORYNEO — financial readiness execution log

**Scope:** first batch, Tasks 1–4 of `docs/superpowers/plans/2026-10-20-oryneo-financial-readiness.md`.  
**Mode:** isolated QA/TEST only. No LIVE transaction or customer email.  
**Last updated:** 2026-10-20 (workspace timestamp: local CI and remote account APIs may report a later UTC date).

## Baseline captured before changes

### GitHub

- PR #46 is open, mergeable and draft; base SHA `173b4425d7d3bbd8a6d92ac9cbe62c4cf8dd35da`, remote code head `b85b8ee633067a6731fb3d43980df809eb4a3ff3`.
- GitHub Actions for that code head: `Verificar CRM v2 antes de publicar` run 202 and `Homologar interface CRM v2.1` run 136 both completed successfully.
- Local isolated branch `feat/payment-method-policy-20261020` had the docs-only commit `cfb2b862e236508bcae396e5841c84fad7deb5ca` ahead of the remote branch when this batch began. Code files matched PR head; the spec and plan are local documentation.

### Supabase

- Project: existing ORYNEO-CRM project; no development branches exist. No paid branch was created.
- Relevant active function versions at audit time:
  - `checkout-intake-noncard-test`: v6, `verify_jwt=true`.
  - `stripe-webhook-financial-qa`: v7, `verify_jwt=false` (body implements Stripe signature verification).
  - `checkout-intake`: v7; `billing-public`: v8; `stripe-webhook`: v8.
- Remote migrations include the QA isolation/identity/Pix policies and signed webhook/invoice-cycle migration through `20261020151049`. The checked-out snapshot has a same-named migration file with a different timestamp; do not reapply or alter it. Any future database change must be a new migration after version reconciliation.
- Read-only counts: QA `orders=1`, `events=3`, `invoice_cycles=1`; CRM `crm_billing_orders=2`, `crm_automation_jobs=13`. The one existing QA order is expired boleto; its invoice cycle is void and the three QA events are `invoice.void`. These pre-existing records were not changed.
- QA tables have RLS enabled and no client policies; service-role-only access is intentional. Security advisors also report existing `SECURITY DEFINER`/Auth/password findings in the project. No unrelated security changes were made in this batch. Performance advisors report existing unindexed foreign keys and unused indexes; no schema changes were made.

### Stripe and contract evidence

- Stripe account-specific tools currently return `UNAUTHORIZED / reauthentication required`; no live or test account values were retrieved during this batch.
- Previous audit docs disagree about whether TEST Pix/boleto were enabled (one says disabled; later PR evidence says enabled). Therefore current availability is **unverified**, not assumed.
- Official Stripe API docs confirm a recurring Price can use `interval=month, interval_count=3`; the material retrieved does not prove that monthly/annual plan items plus quarterly traffic items are billed on the intended independent cadence in one subscription. No mixed-cadence implementation is authorized by this evidence alone.
- Stripe docs state `invoice.paid` can occur for either a successful payment or an invoice marked paid out-of-band; fulfillment must verify actual payment proof. Checkout asynchronous methods require processing success/failure events rather than trusting the return page.
- Supabase changelog scan found the October 12, 2026 TLS 1.2 CBC deprecation, scheduled no earlier than November 10, 2026. It does not change this Deno Edge Function integration.

## Baseline verification

- Local `npm test -- --run` at docs-only local head: **34 files, 198 tests passed** (24.50s test time).
- Local `npm run build`: **passed** (`tsc -b` and Vite production build, 1,755 modules).
- Current PR head GitHub workflows: both required CRM-v2 and browser-homologation workflows **passed**; the CRM-v2 workflow includes the Stripe/billing Deno checks.
- Deno is not installed in this shell, so the CI results above are the available Deno evidence; no local Deno command was represented as run.
- Supabase security/performance advisors were read. No database writes, new Stripe objects, email sends, or LIVE mutations were performed.

## Release matrix status at baseline

| Selection dimension | Local contract | Current readiness |
|---|---|---|
| Plans/cycles | Start, Growth, Scale × monthly/annual | Price contract tests exist; live/test account catalog not re-read because Stripe connector requires reauthentication |
| Setup | One-time setup by plan | Existing server-side catalog item |
| Landing page | BRL 889.90 one-time | Existing server-side catalog item |
| Traffic | BRL 2,969.70 initial quarter + same amount every three months | Existing prices; current QA non-card flow rejects traffic; renewal cadence must be verified |
| Card | Existing subscription checkout | Existing LIVE flow preserved; full TEST journey not established in this batch yet |
| Boleto | Send-invoice subscription in QA | One expired/void QA record exists; new settlements and current Stripe availability unverified |
| Pix | One-time Checkout payment in QA | No automatic renewal; current Stripe availability and settlement path unverified |

No combinations are being declared fully homologated from this baseline alone.

## Batch 1 progress

Tasks 1–4 are in progress. This log will be updated with each task's tests, deployment versions and unresolved external gates. Tasks 5–8 are outside this approved batch.

