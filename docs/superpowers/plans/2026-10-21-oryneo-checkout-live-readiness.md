# ORYNEO Checkout and Live Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a branded, accessible ORYNEO checkout and prove the entire supported billing lifecycle in Stripe TEST before enabling only validated methods for real customer use.

**Architecture:** Continue from draft PR #46 and the existing financial-readiness plan. Keep React/Vite + Checkout Sessions/Elements, Supabase server-authoritative quotes, isolated TEST QA, signed webhooks and idempotent outbox; preserve LIVE card behavior until TEST gates pass. No test creates a LIVE payment.

**Tech Stack:** React 19, TypeScript, Vitest, Supabase Edge Functions/Postgres, Stripe Checkout/Billing/Webhooks, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-21-oryneo-checkout-live-readiness-design.md` and `docs/superpowers/specs/2026-10-20-oryneo-financial-readiness-design.md`.

## Global Constraints

- Keep all synced `sources/` files read-only; work only in the PR checkout.
- No paid Supabase branches; financial QA remains in private `oryneo_financial_qa` with no commercial triggers.
- TEST and LIVE Stripe keys, prices, objects, event endpoints and data remain strictly separate; never fall back to LIVE.
- Never log, commit, display or echo secret keys, signing secrets, card fields, client secrets or public checkout tokens.
- Previously pasted TEST key is not reusable evidence of secure credentials; use a replacement restricted key before declaring QA credential security.
- Never submit a LIVE payment, payment intent, paid invoice, or live checkout as automated QA; a LIVE test purchase is left for the owner after release.
- A signed event plus provider reconciliation is required for paid state; no return-page fulfillment or payment-state inference.
- Card is recurring; boleto invoices are manually paid by billing period; Pix is explicit prepayment without auto-renewal; traffic is separate quarterly billing.
- Do not offer a method unless server eligibility, Stripe capability, UX copy and end-to-end TEST evidence agree.
- No automatic tax collection until active registrations/obligations are verified; do not imply tax inclusion incorrectly.
- Preserve current LIVE webhook endpoint, signing secret, card checkout and CRM records; changes are additive and rollback uses prior versions.

## Review Focus

- Local/deployed Edge Function source drift changes live behavior; compare versions/source before any deploy.
- Client-supplied amount, price ID, method, mode or order token is forged/replayed; server fails closed and returns no checkout.
- Pix pending, boleto open or `invoice.paid` marked out-of-band is not settlement; no access/email until proof matches.
- Mixed interval invoice is late, duplicate, wrong amount, wrong cycle, or after cancellation; item-specific cycle state remains auditable and monotonic.
- Email trigger is replayed, out of order, unconsented or unpaid; send at most once and never to a real customer during QA.

---

### Task 1: Reconcile remote baseline and publish a redacted release map

**Files:**
- Inspect: `docs/financial-qa-evidence-2026-10-20.md`
- Inspect: `docs/releases/2026-10-20-financial-readiness.md`
- Inspect: `supabase/functions/checkout-intake/index.ts`
- Inspect: `supabase/functions/billing-create-order/index.ts`
- Inspect: `supabase/functions/stripe-webhook/index.ts`
- Create/update: `docs/releases/2026-10-21-checkout-live-readiness.md`

**Interfaces:**
- Consumes: current PR head, deployed Edge Function source/version, Supabase secret *names only*, Stripe test/live catalog and method availability.
- Produces: redacted local-vs-deployed comparison, supported quote matrix and explicit blocked gates.

- [ ] **Step 1: Write regression tests for source/config contracts before changing function code.** Assert TEST/LIVE environment lookup, live non-card gate and webhook mode checks.
- [ ] **Step 2: Run focused tests and confirm expected failure for each missing contract.**
- [ ] **Step 3: Compare the active Supabase function files and version/SHA with PR #46 and record drift without printing secret values.**
- [ ] **Step 4: Inspect Stripe prices/method settings in the correct TEST and LIVE contexts using read-only calls; capture names/status only.**
- [ ] **Step 5: Record no-branch state, function versions, prior release evidence and unverified items in the release map.**

### Task 2: Make quote and method eligibility server-authoritative

**Files:**
- Modify: `supabase/functions/_shared/billing/catalog.ts`
- Modify: `supabase/functions/_shared/billing/payment-policy.ts`
- Modify: `supabase/functions/_shared/billing/stripe-payment-forms.ts`
- Test: `src/billing/catalog.test.ts`
- Test: `src/billing/financialQaWebhookPolicy.test.ts`
- Test: `supabase/functions/tests/stripe_payment_forms_test.ts`

**Interfaces:**
- Consumes: validated lookup-key prices and selected plan/cycle/addons/method/environment.
- Produces: immutable server quote and eligibility result `{available, reason, paymentMethod, billingSemantics}`; rejects unsupported method/addon combinations before persistence/provider calls.

- [ ] **Step 1: Add table-driven tests for 24 quote combinations and card/boleto/Pix eligibility, including traffic.**
- [ ] **Step 2: Run focused Vitest/Deno tests and verify the new eligibility cases fail on missing behavior.**
- [ ] **Step 3: Implement the server eligibility policy; use integer cents and active mode-matched Price records only.**
- [ ] **Step 4: Test flexible mixed interval behavior for monthly/annual plan plus quarterly traffic against Stripe TEST, reading back each item and invoice cycle.**
- [ ] **Step 5: Make unsupported or unverified combinations fail closed without silently dropping, merging or changing a line item.**
- [ ] **Step 6: Run all catalog and payment-form tests; expected totals and recurring dates agree with provider results.**

### Task 3: Rework checkout selection and ORYNEO visual system

**Files:**
- Modify: `src/billing/checkout/CheckoutConfigurator.tsx`
- Modify: `src/billing/checkout/CheckoutConfigurator.test.tsx`
- Modify: `src/billing/checkout/checkout.css`
- Modify: `src/billing/PaymentPage.tsx`
- Modify: `src/billing/PaymentPage.test.tsx`
- Modify: `src/billing/payment.css`

**Interfaces:**
- Consumes: server-returned availability and order snapshot; existing ORYNEO logo, plan/addon labels, Stripe Elements and terms.
- Produces: accessible method selection (card/Pix/boleto only when supported), clear itemized upfront/renewal summary, payment-specific explanations and a responsive branded form.

- [ ] **Step 1: Write tests for accessible method radios, method-specific labels/icons, disabled reasons, prices, renewal text, error/retry, and consent before CTA.**
- [ ] **Step 2: Run focused Vitest tests and verify failures are caused by missing UI behavior.**
- [ ] **Step 3: Apply ORYNEO styling: warm neutral surface, brand type/colors from current assets, typography hierarchy, minimal borders, no glow/glass template treatment; retain Stripe-hosted secure input.**
- [ ] **Step 4: Add mobile single-column layout and desktop summary panel; make total and renewal copy legible before payment confirmation.**
- [ ] **Step 5: Run checkout and payment page test files, including keyboard/accessibility assertions and reduced-motion behavior.**

### Task 4: Connect method selection to isolated TEST and guarded LIVE APIs

**Files:**
- Modify: `src/direct-checkout-main.tsx`
- Modify: `src/billing/api.ts`
- Modify: `supabase/functions/checkout-intake/index.ts`
- Modify: `supabase/functions/checkout-intake-noncard-test/index.ts`
- Modify: `supabase/functions/billing-create-order/index.ts`
- Test: `src/App.financial-qa.test.tsx`
- Test: `src/billing/billing-edge-permissions.test.ts`
- Test: `supabase/functions/tests/checkout_intake_noncard_cors.integration.mjs`

**Interfaces:**
- Consumes: the selected payment method and verified server eligibility. TEST route is authenticated and schema-isolated; LIVE non-card returns a stable disabled response until Task 8.
- Produces: a TEST-only QA order or a LIVE card-only order, with identical quote rules and no client-controlled mode or amount.

- [ ] **Step 1: Add tests proving TEST non-card requires CRM membership/JWT, never writes CRM, and LIVE rejects unapproved non-card methods.**
- [ ] **Step 2: Run focused tests; confirm forbidden calls fail before any Stripe/DB write.**
- [ ] **Step 3: Implement routing and method binding; preserve idempotency keys across exact retries and generate new keys on changed selections.**
- [ ] **Step 4: Verify CORS exact origins and auth; do not set wildcard or relax `verify_jwt`.**
- [ ] **Step 5: Run endpoint contract/CORS tests and UI integration tests.**

### Task 5: Complete signed lifecycle reconciliation and transactional triggers

**Files:**
- Modify: `supabase/functions/stripe-webhook-financial-qa/index.ts`
- Modify: `supabase/functions/_shared/billing/financial-qa-webhook-policy.ts`
- Modify: `supabase/functions/_shared/billing/invoice-event-policy.ts`
- Modify: `supabase/functions/_shared/billing/billing-notices.ts`
- Modify: `supabase/functions/_shared/mail/automation-email.ts`
- Modify only if needed: forward-only QA/commercial migration via `supabase migration new <descriptive_name>`
- Test: `supabase/functions/tests/financial_qa_webhook_policy_test.ts`
- Test: `supabase/functions/tests/invoice_event_policy_test.ts`
- Test: `supabase/functions/tests/billing_notices_test.ts`
- Test: `supabase/functions/tests/intake_confirmation_test.ts`

**Interfaces:**
- Consumes: verified provider invoice/session/subscription and persisted order/cycle identities.
- Produces: atomic monotonic state plus outbox jobs with stable dedupe keys; no QA email/provisioning.

- [ ] **Step 1: Add failing tests for valid/invalid signature, wrong mode/account/order/amount/currency, pending Pix, open boleto, paid-out-of-band, paid invoice with no succeeded PaymentIntent, failure, refund, cancel and dispute.**
- [ ] **Step 2: Add order-sequence tests for duplicate success, failure-before-success, late failure-after-success, late payment-after-cancel and quarterly/multi-cycle invoices.**
- [ ] **Step 3: Implement only policy/persistence gaps; verify raw-body HMAC, timestamp tolerance, provider proof and atomic RPC behavior.**
- [ ] **Step 4: Add/test outbox triggers for lead receipt, proposal, payment instruction, settled payment, renewal, failure/overdue, cancellation and implementation-started.**
- [ ] **Step 5: Use fake transport/sink; assert no real recipient, no duplicate send and no send for unpaid/invalid consent.**
- [ ] **Step 6: Run all focused billing/mail Deno and Vitest suites plus Supabase security advisors if schema changes.**

### Task 6: Add controlled direct and reverse E2E matrix

**Files:**
- Create: `supabase/functions/tests/financial_qa_e2e.mjs`
- Modify: `src/App.financial-qa.test.tsx`
- Modify: `src/billing/PaymentPage.test.tsx`
- Update: `docs/releases/2026-10-21-checkout-live-readiness.md`

**Interfaces:**
- Consumes: tasks 1–5.
- Produces: redacted matrix by plan/cycle/addons/method, with event/quote/order/cycle/mail state evidence.

- [ ] **Step 1: Test all supported forward journeys from selection to settlement, CRM state and expected outbox event.**
- [ ] **Step 2: Test reverse journeys from signed TEST events to order/cycle state and expected/suppressed email.**
- [ ] **Step 3: Confirm Pix pending and manual renewal, boleto pending/compensation and card subscription renewal/failure/cancel.**
- [ ] **Step 4: Cancel all test subscriptions and reconcile zero unintended QA/commercial rows and jobs.**
- [ ] **Step 5: Save redacted evidence and mark every unrun/unsupported combination explicitly.**

### Task 7: Deploy isolated QA and prove behavior remotely

**Files:**
- Deploy only when local CI/tests pass: `checkout-intake-noncard-test`, `stripe-webhook-financial-qa`, and any QA-only helpers necessary.
- Update: `docs/releases/2026-10-21-checkout-live-readiness.md`

**Interfaces:**
- Consumes: task 6 green matrix, current remote versions and rollback source.
- Produces: verified deployed QA version and no production side effects.

- [ ] **Step 1: Capture current deployed versions, SHA and remote source for rollback; confirm TEST key is a replacement not exposed in chat.**
- [ ] **Step 2: Deploy only isolated QA functions with explicit JWT settings; do not deploy or merge main LIVE functions.**
- [ ] **Step 3: Run authenticated TEST smoke/E2E including webhook delivery, payment compensation simulation and outbox sink.**
- [ ] **Step 4: Inspect function logs for errors/redaction and query QA/commercial counters; verify expected state and zero customer messages.**

### Task 8: Gate the minimal LIVE release without making a charge

**Files:**
- Modify only if all preceding tasks pass: `supabase/functions/checkout-intake/index.ts`, `supabase/functions/billing-create-order/index.ts`, `supabase/functions/billing-public/index.ts`, `supabase/functions/stripe-webhook/index.ts`
- Update: `docs/releases/2026-10-21-checkout-live-readiness.md`

**Interfaces:**
- Consumes: passing TEST matrix and known deployed source.
- Produces: LIVE function/UI versions with only homologated methods enabled and card-compatible rollback.

- [ ] **Step 1: Add regression tests proving existing LIVE card path is unchanged and unhomologated methods remain closed.**
- [ ] **Step 2: Verify live secrets *names/prefix mode via runtime validation* without exposing values; do not call mutating Stripe operations as a test.**
- [ ] **Step 3: If the safe LIVE smoke cannot validate runtime configuration without creating a live checkout/session, leave that fact in the release report and do not create it.**
- [ ] **Step 4: Deploy minimum LIVE changes only after release gate review; capture previous versions and test read-only/zero-charge paths.**
- [ ] **Step 5: Keep the live purchase step user-initiated and list exact methods the owner can try, with tax/receipt, dunning and rollback notes.**

### Final verification

- [ ] Run `npm test -- --run` and `npm run build`.
- [ ] Run all billing/mail Deno tests in `.github/workflows/ci-crm-v2.yml`.
- [ ] Run CI on the branch; report exact SHA and status.
- [ ] Inspect full diff and secret-pattern scan; no secret, payment data, client secret or real token present.
- [ ] Leave the PR in draft until the matrix is complete and the owner can safely initiate the first real payment.
