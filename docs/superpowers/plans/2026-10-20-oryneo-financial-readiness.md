# ORYNEO Financial Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Prove and safely release the commercial-to-payment journey for every supported plan/add-on/payment-method combination, with reliable CRM state and stage-appropriate transactional email.

**Architecture:** Keep TEST checkout and webhook isolated in `oryneo_financial_qa`; validate and reconcile every event before CRM or email side effects. Preserve the existing card/LIVE checkout and webhook while TEST is completed, then enable only combinations with passing end-to-end evidence. Treat Pix as prepayment without automatic renewal; verify Stripe support before selecting how quarterly traffic renewal coexists with monthly/annual billing.

**Tech Stack:** React/Vitest, Supabase Edge Functions/Deno, Postgres migrations/RPCs, Stripe Checkout/Billing/Webhooks, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-20-oryneo-financial-readiness-design.md`

## Global Constraints

- Do not create paid Supabase branches; use the existing isolated `oryneo_financial_qa` schema.
- Keep Stripe TEST and LIVE credentials, endpoints, objects and data separate; never use LIVE as a fallback.
- Never expose secret keys, tokens, full emails, client secrets or card data in source, logs, tests or reports.
- Only a validated and reconciled Stripe payment may fulfill an order; a return page, open invoice or active subscription is not proof.
- Pix is a one-off prepayment with no automatic renewal claim.
- Do not send test email to real customers or alter LIVE checkout/webhook during TEST work.
- Use exact CORS origins and preserve authentication; do not weaken JWT checks to fix browser failures.
- Preserve financial records; migrations are additive and rollback is by function version/forward repair, never deleting paid records.
- Do not report a combination as ready until the acceptance matrix records its evidence and limitations.

## Review Focus

- A TEST endpoint receives `livemode=true` data or a LIVE secret: reject before persistence or side effects. Test in the financial QA webhook policy and handler.
- Stripe reports `invoice.paid` for `paid_out_of_band` without a settled PaymentIntent: leave unfulfilled. Test invoice proof and webhook reconciliation.
- Duplicate or out-of-order success/failure events arrive: process idempotently and never downgrade paid or duplicate email. Test the webhook and settlement RPC.
- Traffic renewal uses a quarterly price beside monthly/annual plan cadence: use only a Stripe-supported model; test every generated invoice total/cadence before enabling the selection.
- A lead or unpaid deal reaches an implementation/proposal stage: never send a payment-confirmed or implementation email prematurely. Test database scheduling and worker behavior.

---

### Task 1: Access, catalog and deployment preflight

**Files:**
- Inspect: `docs/financial-qa-evidence-2026-10-20.md`
- Inspect: `supabase/functions/_shared/billing/catalog.ts`
- Inspect: `supabase/functions/_shared/billing/environment.ts`
- Create: `docs/releases/2026-10-20-financial-readiness.md`

**Interfaces:**
- Consumes: current Stripe account access, Supabase function versions, existing CI and catalog contract.
- Produces: a redacted baseline of TEST/LIVE account mode, price availability, active QA/production function versions, current row counts, CI SHA, and the exact allowed test combinations. No secret values or new Stripe objects.

- [x] **Step 1: Capture current state read-only.** Record branch/PR SHAs, CI checks, edge-function versions, branch list, relevant QA/CRM counters, catalog keys and payment-method availability. Do not create a session, invoice, customer, branch or secret.
- [x] **Step 2: Restore Stripe read access through the connected account flow.** Verify account mode and retrieve TEST catalog/method settings; if unavailable, mark dependent external tests blocked and continue offline-only work. Never switch to LIVE to unblock a TEST check.
- [x] **Step 3: Verify current Stripe API support for mixed billing intervals and asynchronous Pix/boleto confirmation.** Record the authoritative API behavior in the release record before choosing the traffic-renewal model.
- [x] **Step 4: Run baseline commands.** Run `npm test -- --run`, `npm run build`, and the Stripe/billing Deno test list from `.github/workflows/ci-crm-v2.yml`; save results with the tested SHA.
- [x] **Step 5: Commit the redacted baseline.** Commit only evidence and plan/spec files; verify no secret-like values with `git diff --check` and targeted secret-pattern scan.

### Task 2: Complete the isolated QA browser path

**Files:**
- Modify: `supabase/functions/checkout-intake-noncard-test/index.ts`
- Modify: `src/billing/checkout/CheckoutConfigurator.tsx`
- Modify: `src/billing/PaymentPage.tsx`
- Test: `supabase/functions/tests/checkout_intake_noncard_cors.integration.mjs`
- Test: `src/App.financial-qa.test.tsx`

**Interfaces:**
- Consumes: authenticated QA session and supported payment-method/catalog contract from Task 1.
- Produces: browser request with exact localhost origin, JWT, TEST mode and selected method; endpoint returns a typed, non-secret status/session response or a fail-closed error.

- [x] **Step 1: Keep the regression test for Vite preflight and extend it to assert exact allowed origin, methods/headers and denied unknown origin.** Test only `OPTIONS` against remote until a deploy is explicitly available. Existing QA endpoint remains isolated; authenticated/payment E2E is still a gate.
- [ ] **Step 2: Add frontend tests that unauthenticated or production sessions cannot call the QA endpoint, and that network/CORS errors preserve selection without claiming a charge.**
- [ ] **Step 3: Make the minimal CORS/frontend correction; do not change `verify_jwt`, live endpoints or wildcard behavior.**
- [ ] **Step 4: Run focused Vitest and Deno tests plus build.** Expected: exact Vite origin receives `204`, unrelated origin receives `403`, unauthenticated transaction receives `401`, TEST selection remains intact.
- [x] **Step 5: Deploy only `checkout-intake-noncard-test` using the approved Supabase path when deployment review is available.** Captured version v9; kept QA webhook isolated. Authenticated payment E2E remains pending.
- [ ] **Step 6: Verify deployed preflight from the browser and authenticated QA route; inspect logs for redaction and confirm QA order/event counters are unchanged for preflight-only checks.** Browser-authenticated route remains pending; earlier remote QA webhook calls returned 503 and require investigation.

### Task 3: Define and test the complete quote/method matrix

**Files:**
- Modify: `supabase/functions/_shared/billing/catalog.ts`
- Modify: `supabase/functions/_shared/billing/stripe-payment-forms.ts`
- Modify: `src/billing/checkout/CheckoutConfigurator.tsx`
- Modify: `src/billing/PaymentPage.tsx`
- Test: `src/billing/catalog.test.ts`
- Test: `src/billing/checkout/CheckoutConfigurator.test.tsx`
- Test: `supabase/functions/tests/stripe_payment_forms_test.ts`

**Interfaces:**
- Consumes: the authoritative TEST catalog and payment support from Task 1.
- Produces: server-calculated quote keyed by plan/cycle/add-ons/method; UI summary of initial amount, renewal cadence, one-time setup/add-ons and prepaid Pix period.

- [x] **Step 1: Add table-driven quote tests for Start/Growth/Scale × monthly/annual × none/landing/traffic/both (24 selections).** Assert exact integer cents, initial amount and each recurring component; reject unknown/repeated add-ons and missing/mismatched Stripe prices. Existing catalog and method tests cover the supported surface; traffic on non-card remains blocked.
- [ ] **Step 2: Add method eligibility tests for card, boleto and Pix across that quote matrix.** Unsupported combinations fail closed with an explanation; do not silently drop traffic or convert a subscription to one-off.
- [ ] **Step 3: Add UI tests proving setup, landing page, traffic's initial three-month amount, traffic renewal and Pix prepaid duration are visibly distinct before acceptance.** The UI must not describe Pix as auto-renewing.
- [ ] **Step 4: Implement the smallest shared quote/eligibility API in the existing catalog/payment modules and render its result.** Keep prices server-authoritative and preserve the current landing-page prefill contract.
- [x] **Step 5: Run focused quote/form/UI tests and `npm run build`; expected all 24 quote cases and the supported/unsupported method matrix pass with no price IDs or amounts trusted from browser input.** Local branch verification is recorded in `docs/releases/2026-10-21-checkout-live-readiness.md`; no remote paid settlement has been claimed.

### Task 4: Implement a supported quarterly traffic renewal model

**Files:**
- Modify: `supabase/functions/_shared/billing/stripe-payment-forms.ts`
- Modify: `supabase/functions/_shared/billing/stripe-noncard-service.ts`
- Modify: `supabase/functions/checkout-intake-noncard-test/index.ts`
- Modify: `supabase/functions/stripe-webhook-financial-qa/index.ts`
- Test: `supabase/functions/tests/stripe_payment_forms_test.ts`
- Test: `supabase/functions/tests/stripe_noncard_service_test.ts`
- Test: `supabase/functions/tests/financial_qa_webhook_policy_test.ts`

**Interfaces:**
- Consumes: verified quote and Stripe billing behavior from Tasks 1 and 3.
- Produces: an idempotent subscription/invoice schedule for a traffic initial quarter and each quarterly renewal, linked to the same CRM order but independently reconcilable from the plan cadence.

- [ ] **Step 1: Test the Stripe-supported mixed-interval choice identified in Task 1.** If a single subscription does not produce the expected plan and quarterly invoices, pin the separate quarterly billing model in a test before implementation.
- [ ] **Step 2: Add tests for traffic initial payment, first renewal date, subsequent 3-month cadence, cancellation, retries, duplicate creation recovery and no renewal after order cancellation.** Assert expected BRL values against catalog constants.
- [ ] **Step 3: Implement the supported model behind TEST-only server calls with stable idempotency keys and persisted provider IDs before exposing invoice links.** Keep existing card/LIVE path unchanged.
- [ ] **Step 4: Test boleto initial invoice and subsequent traffic invoice independently.** Neither open invoice may grant access; paid proof must match customer/order/amount/interval.
- [ ] **Step 5: Run targeted Deno tests and a Stripe TEST dry-run/read-back.** Do not finalize or pay invoices merely to make test data; use a reversible/controlled test transaction only when the Stripe test environment supports it.

### Task 5: Make webhook reconciliation bidirectional and monotonic

**Files:**
- Modify: `supabase/functions/stripe-webhook-financial-qa/index.ts`
- Modify: `supabase/functions/_shared/billing/financial-qa-webhook-policy.ts`
- Create: new forward-only QA migration generated with `supabase migration new financial_qa_event_reconciliation`
- Test: `supabase/functions/tests/financial_qa_webhook_policy_test.ts`
- Test: new `supabase/functions/tests/financial_qa_event_reconciliation_test.ts`

**Interfaces:**
- Consumes: verified session/invoice/payment proof and QA order identity.
- Produces: monotonic order/invoice-cycle state and an audit event; repeat/out-of-order events return idempotent outcomes.

- [ ] **Step 1: Add test cases for invalid signature, TEST/LIVE mismatch, wrong customer/subscription/invoice/order, currency/amount mismatch and payment-out-of-band.** All must leave the order unpaid with no side effects.
- [ ] **Step 2: Add sequence tests for `created → pending → paid → delayed failure`, duplicate success and failure-before-success.** Expected final paid state is never downgraded and side effects are emitted once.
- [ ] **Step 3: If tests expose persistence gaps, run `supabase migration new financial_qa_event_reconciliation`, then add a forward-only QA RPC/migration.** Keep RLS enabled, grant mutation only to service role, and retain commercial schema untouched.
- [ ] **Step 4: Implement validation then record event/state atomically; failures go to a reviewable state and do not grant entitlement.** Keep webhook signature check over the raw body.
- [ ] **Step 5: Run all financial QA policy and migration tests in a disposable local transaction (ROLLBACK), then Supabase advisors.** Confirm zero surviving QA rows and zero changed CRM order/job counts.

### Task 6: Cover stage-triggered emails and financial notices

**Files:**
- Create: new forward-only commercial automation migration via `supabase migration new financial_stage_email_outbox` only if tests prove a schema change is required
- Modify: `supabase/functions/intake-mail-worker/index.ts`
- Modify: `supabase/functions/_shared/mail/automation-email.ts`
- Modify: `supabase/functions/_shared/billing/billing-notices.ts`
- Test: `supabase/functions/tests/intake_confirmation_test.ts`
- Test: `supabase/functions/tests/billing_notices_test.ts`
- Test: new `supabase/functions/tests/commercial_stage_email_policy_test.ts`

**Interfaces:**
- Consumes: CRM stage transitions, lead consent, settled order/invoice events and outbox job identity.
- Produces: one idempotent mail job per valid event/stage; worker claim/send/retry state remains auditable.

- [ ] **Step 1: Add policy tests for lead received, first contact, proposal/contract action, payment pending/issued, payment confirmed/failed/expired, renewal paid/failed, cancellation and implementation started.** Pin which transitions are automatic and which remain operator-initiated; no message to a customer in test.
- [ ] **Step 2: Test that implementation-started requires a settled paid order and a valid stage transition; a lead or unpaid deal produces no welcome/implementation job.**
- [ ] **Step 3: Test outbox replay, worker retry, concurrent claim, duplicate event and suppression; each must produce at most one sent message per idempotency key.**
- [ ] **Step 4: Add only missing forward migration/policy and server logic; reuse existing templates and do not send mail from webhook request path.**
- [ ] **Step 5: Verify generated email copy corresponds to the true payment method, due date, renewal rule and state, especially Pix's no-auto-renewal and boleto's pending compensation.**
- [ ] **Step 6: Run mail/billing tests with a fake transport, then a single authorized internal test recipient after deployment access is confirmed.** Verify outbox, Sent/worker status and no customer recipient.

### Task 7: End-to-end TEST matrix, including reverse journeys

**Files:**
- Test: `src/App.financial-qa.test.tsx`
- Test: `src/billing/PaymentPage.test.tsx`
- Test: `supabase/functions/tests/checkout_intake_noncard_cors.integration.mjs`
- Create: `supabase/functions/tests/financial_qa_e2e.mjs`
- Update: `docs/releases/2026-10-20-financial-readiness.md`

**Interfaces:**
- Consumes: supported combinations and order/event/mail contracts from Tasks 1–6.
- Produces: redacted evidence matrix with per-combination state and event/order/mail correlation.

- [ ] **Step 1: Run front-to-back browser flows for each supported plan/cycle/add-on/method: select → consent → order → checkout → signed settlement → CRM state → expected email job.** Unsupported combinations must stop before session/invoice creation.
- [ ] **Step 2: Run reverse flows starting from signed Stripe TEST events: settled/failed/expired/canceled/renewed/duplicated/out-of-order event → expected QA order/invoice/CRM status → expected/no email.**
- [ ] **Step 3: For Pix, verify pending does not fulfill, a paid async event fulfills once, and later renewal creates no automatic charge. For boleto, verify a hosted/open invoice does not fulfill and simulated bank compensation does. For card, verify success/decline and subscription lifecycle.**
- [ ] **Step 4: Exercise all 24 quote combinations and every supported payment method against the matrix.** Redact customer addresses and provider secrets from captured evidence.
- [ ] **Step 5: Reconcile and cancel/end test subscriptions where appropriate.** Query Supabase to prove no unintended QA orders/jobs remain and no commercial table changed.
- [ ] **Step 6: Run `npm test -- --run`, `npm run build`, the Deno billing/mail suites listed in CI, browser CI and Supabase advisors.** Record exact SHA, function versions and failures.

### Task 8: Controlled LIVE readiness and first-customer release

**Files:**
- Modify only after Tasks 1–7 pass: `supabase/functions/checkout-intake/index.ts`, `supabase/functions/billing-create-order/index.ts`, `supabase/functions/billing-public/index.ts`, `supabase/functions/stripe-webhook/index.ts`, and their tests.
- Update: `docs/releases/2026-10-20-financial-readiness.md`

**Interfaces:**
- Consumes: fully passing TEST evidence and payment/method rules.
- Produces: LIVE configuration/code only for explicitly validated methods; existing card path remains backward compatible; disabled combinations return a clear, non-billing response.

- [ ] **Step 1: Compare current LIVE deployed function source/version with proposed diff and prove no change to card customer/order/webhook behavior.**
- [ ] **Step 2: Add regression tests proving production still rejects non-card until that exact method passes the release gate.** Ensure lookup keys resolve only LIVE prices and the LIVE webhook validates `livemode=true`.
- [ ] **Step 3: If a LIVE account setting/API mutation is actually needed, use the required per-operation Stripe confirmation; never create a charge as a readiness check.** If methods cannot be enabled without a separately confirmed Stripe action, preserve current settings and report the precise manual gate.
- [ ] **Step 4: Deploy additive schema first, then only approved LIVE functions, then CRM UI.** Record old versions and rollback targets; keep the `stripe-webhook` endpoint URL and secret binding intact.
- [ ] **Step 5: Smoke test LIVE read-only/zero-charge paths: method eligibility, catalog mode, CORS/auth, public order status and rejection of unapproved combinations.** Do not submit a LIVE Checkout Session or create a PaymentIntent.
- [ ] **Step 6: Publish final matrix and first-customer checklist with verified eligible combinations, limitations, rollback versions and test results.** Mark “ready to charge first customers” only if every advertised method has a passing TEST journey and no critical/security/CI failures remain.

