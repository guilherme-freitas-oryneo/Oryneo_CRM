# Purchase Journey Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the safe, testable foundation for the ORYNEO purchase journey: a branded accessible checkout, per-competence assisted-payment obligations, extensible automation jobs, and webhook-to-obligation reconciliation.

**Architecture:** Keep the current Checkout Session + Stripe Elements integration for card/boleto while separating presentation from financial state. Add `crm_billing_obligations` as the authority for an assisted Pix or boleto competence, and make the existing automation queue reference its financial subject rather than relying only on a deal. Extend the signed Stripe webhook to settle one obligation atomically and cancel only its own reminders.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Stripe Checkout Sessions/Elements, Supabase Postgres, Supabase Edge Functions, Deno tests, existing SMTP outbox.

**Spec:**
- `docs/superpowers/specs/2026-10-21-jornada-completa-de-compra-design.md`
- `docs/superpowers/specs/2026-10-21-pix-recorrente-assistido-design.md`

## Global Constraints

- Preserve current LIVE checkout and webhook semantics until TEST evidence proves each new path.
- Do not add `payment_method_types`; use Stripe dynamic payment methods and separate compatible flows.
- Do not expose secret keys, webhook secrets, client secrets, full Pix strings, or complete tax identifiers.
- The browser never determines price, Stripe IDs, entitlement, order state, or payment confirmation.
- A verified signed webhook, not a browser return, changes financial state.
- Keep `billing_environment` in every obligation, Stripe lookup, event and worker query; TEST and LIVE never cross.
- Use existing Stripe Elements, Radix primitives and Lucide icons; add no generic UI package.
- Every exposed table uses RLS and has no direct anonymous access.
- Every delivery uses TDD, a normal non-force commit, targeted tests, and the relevant full test suite.

## Review Focus

- A duplicate or delayed event must not pay two obligations or cancel another competence's reminders; Task 4 tests scoped, idempotent settlement.
- A customer must not see Pix represented as automatic renewal in Brazil; Task 1 tests payment-profile copy.
- A retry must not duplicate the same competence; Task 2 tests canonical keys and uniqueness.
- A TEST event/job must never resolve a LIVE order; Task 4 tests environment mismatch before update.
- A 320 px keyboard user must retain a usable payment form and clear total; Task 1 tests semantics and responsive controls.

---

## File Structure

- `src/billing/PaymentPage.tsx` owns public payment composition and payment-profile disclosure.
- `src/billing/payment.css` owns only checkout tokens, responsive grid and interaction states.
- `supabase/functions/_shared/billing/obligations.ts` defines competence key and transition helpers.
- `supabase/migrations/<generated>_crm_billing_obligations_and_automation_subjects.sql` adds obligations, RLS, RPC boundaries and queue subject keys.
- `supabase/functions/billing-recurring-worker/index.ts` creates TEST-only assisted-payment sessions and jobs.
- `supabase/functions/stripe-webhook/index.ts` reconciles one obligation from a verified event.
- `supabase/functions/_shared/mail/automation-email.ts`, `supabase/functions/intake-mail-worker/handler.ts`, and `src/automation/AutomationStatus.tsx` receive subject-aware types/labels.

## Phase Boundary

This phase does not publish new LIVE behavior, create a real charge, send an external production email, or auto-suspend a customer. It produces the TEST-only foundation for later CRM sending, scheduler registration, complete email copy and browser QA.

### Task 1: Rebuild the public checkout presentation without changing financial semantics

**Files:**
- Modify: `src/billing/PaymentPage.tsx`
- Modify: `src/billing/payment.css`
- Modify: `src/billing/PaymentPage.test.tsx`
- Modify: `src/billing/StripePayment.test.tsx`
- Modify: `src/billing/payment-contrast.test.ts`

**Interfaces:**
- Consumes: `PublicBillingOrder`, `CheckoutElementsProvider`, `BillingAddressElement`, `PaymentElement`.
- Produces: `paymentProfileDisclosure(order: PublicBillingOrder): { title: string; detail: string }` exported from `PaymentPage.tsx`.

- [ ] **Step 1: Write the failing presentation tests**

Assert one page heading, `Resumo do pedido`, `Total de hoje`, the profile disclosure, and a responsive summary toggle. Assert cards say “Cartão — renovação automática”, Pix says “Pix — você confirma cada vencimento no banco”, and boleto explains compensation.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --run src/billing/PaymentPage.test.tsx src/billing/StripePayment.test.tsx src/billing/payment-contrast.test.ts`

Expected: FAIL because semantic grouping, disclosure helper and responsive control do not yet exist.

- [ ] **Step 3: Implement `paymentProfileDisclosure(order)` and the editorial checkout layout**

Add optional server-provided `payment_profile` with a safe fallback. Replace glow/dark-summary treatment with marfim, ink and ORYNEO blue; leave values and Stripe Elements untouched. Use native `<details>` for mobile summary rather than a custom accordion.

- [ ] **Step 4: Verify**

Run: `npm test -- --run src/billing/PaymentPage.test.tsx src/billing/StripePayment.test.tsx src/billing/payment-contrast.test.ts && npm run build`

Expected: selected tests pass and Vite builds cleanly.

- [ ] **Step 5: Commit**

```powershell
git add src/billing/PaymentPage.tsx src/billing/payment.css src/billing/PaymentPage.test.tsx src/billing/StripePayment.test.tsx src/billing/payment-contrast.test.ts
git commit -m "feat: redesign branded checkout experience"
```

### Task 2: Add assisted-payment obligations and subject-scoped automation jobs

**Files:**
- Create: `supabase/functions/_shared/billing/obligations.ts`
- Create: `supabase/functions/tests/billing_obligations_test.ts`
- Create: `supabase/migrations/<generated>_crm_billing_obligations_and_automation_subjects.sql`
- Modify: `src/automation/AutomationStatus.tsx`
- Modify: `src/automation/AutomationStatus.test.tsx`

**Interfaces:**
- Consumes: `crm_billing_orders`, `crm_automation_jobs`, canonical cents and `billing_environment`.
- Produces: `type AssistedPaymentMethod = 'pix_assisted' | 'boleto_assisted'`; `type ObligationState = 'scheduled' | 'open' | 'processing' | 'paid' | 'expired' | 'failed' | 'overdue' | 'canceled' | 'requires_review'`; `competenceKey(kind: string, dueAt: string): string`; `canTransitionObligation(from, to): boolean`.

- [ ] **Step 1: Write failing domain tests**

Test stable monthly `YYYY-MM`, quarterly `YYYY-QN`, no paid-to-failed downgrade, and TEST/LIVE identity separation.

- [ ] **Step 2: Verify failure**

Run: `deno test --allow-env supabase/functions/tests/billing_obligations_test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement domain module and additive migration**

Use `supabase migration new crm_billing_obligations_and_automation_subjects` to obtain the exact migration name. Add obligations, RLS, service-role-only claim/settle RPCs, unique `(order_id, method, obligation_kind, competence_key, billing_environment)`, and nullable `subject_type`, `subject_id`, `occurrence_key` to jobs. Replace old `(deal_id, job_type)` uniqueness with a subject-aware index that preserves legacy rows.

- [ ] **Step 4: Verify TEST schema safety**

Run domain tests, inspect the generated migration, apply only to intended TEST surface after review, and run Supabase security advisor.

Expected: tests pass; no new critical RLS/exposure advisory.

- [ ] **Step 5: Commit**

```powershell
git add supabase/functions/_shared/billing/obligations.ts supabase/functions/tests/billing_obligations_test.ts supabase/migrations src/automation/AutomationStatus.tsx src/automation/AutomationStatus.test.tsx
git commit -m "feat: add assisted payment obligations"
```

### Task 3: Create the TEST-only recurring-payment worker contract

**Files:**
- Create: `supabase/functions/billing-recurring-worker/index.ts`
- Create: `supabase/functions/tests/billing_recurring_worker_test.ts`
- Modify: `supabase/functions/_shared/billing/environment.ts`
- Modify: `supabase/functions/_shared/billing/public-status.ts`

**Interfaces:**
- Consumes: `AssistedPaymentMethod`, obligations, server-only Stripe secret and `getBillingEnvironmentConfig`.
- Produces: `nextAssistedPaymentSchedule(method, dueAt): Array<{ job_type: 'pix_due_email' | 'assisted_payment_reminder_email' | 'financial_review_required'; occurrence_key: string; due_at: string }>` and a JWT-protected worker endpoint.

- [ ] **Step 1: Write failing worker-contract tests**

Assert Pix schedules initial notice seven days before due, reminders three days before/due/+1/+3, review +5; boleto has the same schedule; retry cannot create a second competence.

- [ ] **Step 2: Verify failure**

Run: `deno test --allow-env supabase/functions/tests/billing_recurring_worker_test.ts`

Expected: FAIL because helper and worker do not exist.

- [ ] **Step 3: Implement TEST-safe worker**

The worker claims due candidates via service-role RPC, rechecks canonical values/environment, creates one-time BRL Stripe payment only when `billing_environment='test'`, persists Stripe ID before scoped jobs, and returns aggregate counts. For LIVE it returns `LIVE_NOT_ENABLED` without contacting Stripe.

- [ ] **Step 4: Verify**

Run: `deno test --allow-env supabase/functions/tests/billing_recurring_worker_test.ts supabase/functions/tests/billing_obligations_test.ts`

Expected: all tests pass without secret access or Stripe calls.

- [ ] **Step 5: Commit**

```powershell
git add supabase/functions/billing-recurring-worker supabase/functions/tests/billing_recurring_worker_test.ts supabase/functions/_shared/billing/environment.ts supabase/functions/_shared/billing/public-status.ts
git commit -m "feat: add assisted payment worker contract"
```

### Task 4: Reconcile assisted payments and expose subject-aware automation status

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts`
- Modify: `supabase/functions/_shared/billing/webhook-environment.ts`
- Modify: `supabase/functions/_shared/mail/automation-email.ts`
- Modify: `supabase/functions/intake-mail-worker/handler.ts`
- Modify: `src/automation/AutomationStatus.tsx`
- Modify: `src/automation/AutomationStatus.test.tsx`
- Create: `supabase/functions/tests/assisted_payment_webhook_test.ts`

**Interfaces:**
- Consumes: persisted obligation Stripe object ID, verified event environment, event ID, amount/currency, `canTransitionObligation`.
- Produces: `settleAssistedPaymentEvent(input): Promise<'paid' | 'processing' | 'failed' | 'expired' | 'ignored'>` and subject-aware email dispatch input.

- [ ] **Step 1: Write failing webhook tests**

Cover valid TEST Pix success, duplicate success, late failure after success, mismatched amount, mismatched environment and another obligation. Assert only matching reminders are cancelled and a duplicate success does not enqueue a second confirmation.

- [ ] **Step 2: Verify failure**

Run: `deno test --allow-env supabase/functions/tests/assisted_payment_webhook_test.ts`

Expected: FAIL because no reconciliation branch exists.

- [ ] **Step 3: Implement reconciliation and automation labels**

After existing signature/environment checks, lookup obligation by persisted Stripe object ID plus environment; validate amount/currency; call transaction-scoped service RPC. Add grouped labels for payment, renewal and review jobs while preserving current lead/implementation behavior.

- [ ] **Step 4: Verify**

Run: `deno test --allow-env supabase/functions/tests/assisted_payment_webhook_test.ts supabase/functions/tests/webhook_environment_test.ts supabase/functions/tests/billing_renewal_welcome_test.ts && npm test -- --run src/automation/AutomationStatus.test.tsx src/billing/environment.test.ts`

Expected: all selected tests pass; prior environment guards remain intact.

- [ ] **Step 5: Commit**

```powershell
git add supabase/functions/stripe-webhook/index.ts supabase/functions/_shared/billing/webhook-environment.ts supabase/functions/_shared/mail/automation-email.ts supabase/functions/intake-mail-worker/handler.ts supabase/functions/tests/assisted_payment_webhook_test.ts src/automation/AutomationStatus.tsx src/automation/AutomationStatus.test.tsx
git commit -m "feat: reconcile assisted payment events"
```

## Phase 1 Verification Gate

- [ ] Run relevant full frontend and Deno suites, then `npm run build`.
- [ ] Run `git diff --check` and leave worktree clean after commits.
- [ ] Run Supabase security advisors after the additive migration.
- [ ] Deploy only TEST-safe worker/function revisions to isolated QA; never replace production webhook.
- [ ] Record TEST evidence for each state before planning Phase 2.

## Deferred Phase 2

Plan CRM “Enviar cobrança”, email content/outbox, scheduler registration, payment-profile selection, real Pix/boleto TEST paths, browser QA at 320/390/768/1440 px, and a separate LIVE rollout after the TEST evidence.
