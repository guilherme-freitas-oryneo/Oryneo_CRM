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

### Results through Tasks 1–4

- Task 1 baseline is complete as recorded above.
- Task 2: local QA panel guard/error-path tests and expanded CORS integration assertions are present. The remote Vite-origin `OPTIONS` request returned **403** (the unrelated origin also returns 403, fail-closed). Local function source already includes `http://localhost:5173`; remote function remains v6. Attempted deploy did not execute: the Supabase tool rejected the entrypoint path, so no function version changed. Do not claim the browser QA path is fixed. No order/session was created by preflight checks.
- Task 3: extended 24-selection catalog assertions and checkout disclosure test; local frontend suite passes. Existing non-card server validation rejects traffic add-on for both boleto and Pix (`Tráfego trimestral não homologado neste método.`). No method availability was confirmed against the Stripe account. Pix prepaid period/method eligibility remain unspecified and are not advertised as ready.
- Task 4: **not implemented** because Stripe account reauthentication is required and the supported mixed-cadence invoice behavior cannot be verified. Existing QA non-card traffic rejection remains in place. Do not permit mixed plan/quarterly traffic billing until account TEST read-back and the necessary reverse-event reconciliation are available.
- Targeted Vitest after local edits: 34 files, 202 tests passed. `npm run build`: passed. `git diff --check`: passed. Deno is unavailable locally; no new Deno test result is claimed.
- No Stripe transaction/session, Supabase data mutation, LIVE change, secret update, or test email was performed. Existing QA/CRM counts remain as baseline because verification was read-only.

At the end of the first batch, the deployment/account-dependent release gates were not clear and no payment path was certified. The subsequent continuation is recorded below.

## Continuation — Tasks 5–8

- Task 2 follow-up: deployed only `checkout-intake-noncard-test` as **v7**, retaining `verify_jwt=true`. Post-deploy integration checks passed: allowed `http://localhost:5173` preflight returned 204 with exact origin/method/headers; unrelated origin returned 403 without reflection; unauthenticated POST returned 401. No QA order/session was created. Production functions remained at their audited versions (`checkout-intake` v7, `stripe-webhook` v8, `billing-public` v8).
- Task 5 review: remote `oryneo_qa_boleto_invoice_event` is `SECURITY DEFINER` with an empty `search_path`, locks the QA order row, validates TEST boleto identity/status/amount, deduplicates by event key, and preserves paid invoice/order state against later failure events. The event policy verifies `invoice.paid` using an InvoicePayment plus succeeded PaymentIntent and rejects out-of-band amounts. Added explicit out-of-band rejection to the pure proof helper. Local tests cover signature/identity/payment proof; **no disposable Postgres replay transaction was run**, so database sequence testing remains outstanding.
- Task 6 review: existing outbox uses delayed jobs, unique `(deal_id, job_type)`, `FOR UPDATE SKIP LOCKED`, retry state and authorized worker token. Existing tests use fake mail transport. Hardened job-type parsing so an unknown outbox type fails closed instead of defaulting to a lead email. No mail was sent; no production mail worker was deployed.
- Stripe account read remains unavailable (`reauthentication required`). No test customer, checkout, invoice, subscription or settlement was created. Deno runtime was obtained through the npm registry cache; the CI-listed billing/mail test sets passed locally: **108 tests, 0 failures**. Vitest: **36 files, 204 tests passed**. Production build passed; `git diff --check` passed.
- Tasks 7–8 remain **not certified**: no authenticated Stripe TEST event/transaction matrix, browser front-to-back journey, cancellation/reconciliation, or provider read-back could be executed without Stripe account access. Consequently no LIVE methods or first-customer charging are declared ready. LIVE functions/settings were not modified.
- Local code changes are not yet pushed to PR #46. Supabase QA function v7 is live, isolated and versioned; no other Supabase functions or database rows were changed in this continuation.

