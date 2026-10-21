# ORYNEO checkout and LIVE readiness — 2026-10-21

## Decision

**Not yet cleared for a customer-facing LIVE purchase test from this branch.** The active Stripe LIVE account has an enabled reconciliation endpoint and the existing LIVE checkout is intended to remain card-only, but neither a LIVE runtime checkout smoke nor a complete TEST settlement-to-webhook-to-notification journey has been verified in this release. Do not infer readiness from a connected Stripe account, saved secret names, UI state, or a successful local build.

No LIVE charge, Checkout Session, invoice, subscription, or webhook change was created in this audit. One QA-only Supabase function (`checkout-intake-noncard-test` v9) was deployed to the existing project; it remains JWT-protected and TEST-only. No production checkout/webhook deployment or paid branch was created. Existing user data and synced `sources/` files were not changed.

## Verified platform snapshot

- Stripe account contexts returned by the connected integration: `Oryneo LTDA` is LIVE; `Área restrita de Oryneo LTDA` is TEST.
- Stripe webhook endpoints are enabled in both modes.
  - TEST has an isolated `stripe-webhook-financial-qa` endpoint for boleto/Pix QA and a separate CRM reconciliation endpoint.
  - LIVE has a `stripe-webhook` endpoint for checkout completion/async outcomes, invoice paid/failed, and subscription updated/deleted.
- Supabase project `ucikrafwfzamxvweuvgk` currently has no development branches. No paid branch was created.
- Active relevant Edge Functions: `checkout-intake` v8, `billing-create-order` v12, `billing-public` v9, `stripe-webhook` v9, `checkout-intake-noncard-test` v9, and `stripe-webhook-financial-qa` v8.
- Supabase security advisor reports RLS-enabled tables without policies (including isolated financial-QA tables and selected CRM tables), four authenticated-executable `SECURITY DEFINER` RPCs, and disabled leaked-password protection. A read-only grants check confirmed the financial-QA tables do not grant `SELECT` to `anon` or `authenticated`; the service role is the only role with table access. `crm_stripe_events` and `crm_billing_welcome` also deny `anon` and `authenticated` SELECT. The four flagged RPCs deny `anon`, allow only `authenticated`, and their current migration source checks CRM membership (and `crm_undo` checks operation ownership). No schema or policy change was made; the lint alerts remain for future review.
- Supabase performance advisor reports 8 unindexed foreign keys and 20 unused indexes. These are informational, some span unrelated CRM areas; no production index was added or removed in this billing-readiness pass.
- The lead-confirmation cron is configured active every minute and had 1,440 successful runs in the last 24 hours. However, all 13 persisted `lead_received_email` jobs are `cancelled` with zero attempts, and there are no `implementation_started_email` jobs. This proves the poller runs, not that a real email trigger was delivered. Do not requeue old leads; validate future triggers using a fake/sink recipient first. Post-payment welcome mail also remains an unverified LIVE side effect.
- Prior Dashboard review showed secret *names* for TEST/LIVE Stripe configuration, with values hidden. The connected account and Stripe catalog reads do not prove the deployed Edge Functions can use those secrets. Do not reveal or reuse credentials pasted in conversation.
- Fresh Stripe TEST read of the existing QA boleto found its invoice `void`, `amount_paid=0`, and subscription `canceled`; the isolated QA order is `expired`. There is no Pix order in the isolated QA table. No end-to-end paid webhook settlement has yet been demonstrated.

## Source drift that must be resolved

Remote Edge Function source was fetched read-only and compared with this branch:

- Active `checkout-intake` v8 and `billing-create-order` v12 do not contain the explicit `payment_method` validation present in the local branch. Their active source must be reconciled against the exact commit and deployed artifact before a release; do not replace either live function with an unreviewed deployment.
- The production `stripe-webhook` v9 is active and signature-verifies events. Its Stripe endpoint exists, but endpoint presence is not proof of a recent successful delivery or correct DB/mail side effects.
- The isolated QA webhook v8 verifies Stripe TEST signatures and re-fetches provider state; its database effects stay in `oryneo_financial_qa` and it does not send email or fulfill CRM orders.

## Checkout UI work in this branch

The payment page now uses ORYNEO graphite/indigo/warm-white tokens, removes the remote DM Sans import and glow treatment, identifies card/Pix/boleto with icons and accessible labels, adds a named order summary, and displays the payable total in the CTA. Tests tolerate the locale's nonbreaking currency space.

The QA panel in this branch now selects plan, cycle, landing-page add-on, and Pix/Boleto. It displays the server-shared catalog quote, opens only a validated Stripe-hosted TEST invoice, embeds Stripe Checkout Elements for Pix, and offers server-side reconciliation. The deployed QA-only intake endpoint refuses to persist a Pix paid state from polling: it requires the separately signed webhook to have recorded settlement. Boleto polling also never marks an invoice compensated. Returning Pix sessions show the persisted amount rather than an invented default plan. Traffic remains unavailable for Pix/Boleto until quarterly renewal is verified. It does **not** include an isolated QA card-subscription route; the commercial card checkout is LIVE-only and was not used for QA. This UI is still branch-only: the public GitHub Pages root does not yet include the QA panel, and PR browser QA uses a loopback-only preview rather than an interactive published preview.

The payment-method badge reflects the method already returned by the server; this change does **not** add a checkout method selector or make Pix/boleto available on LIVE. Do not advertise methods until server eligibility and full TEST settlement are proven. Annual/monthly card selection and quarterly traffic are not fully re-certified by this UI change.

## Fresh local verification

- `npm test -- --run`: 36 files, 210 tests passed locally after the lazy-load change.
- `npm run build`: TypeScript and Vite production build passed after the lazy-load change.
- GitHub Actions for commit `f171c10`: `build`, `edge`, and `browser-qa` all passed. Browser QA is mocked and loopback-only; it does not make a Stripe payment or deliver a webhook.
- `git diff --check` passed after the latest code changes.

## Remaining release gates

1. Reconcile local and active Edge Function source against the PR commit; add explicit artifact/version and rollback evidence.
2. Confirm TEST and LIVE runtime secret *availability/mode* without printing values; replace any credential exposed in conversation before calling QA credentials secure.
3. Run authenticated, isolated TEST checkout and simulated payment settlement for Pix; run boleto payment and compensation; verify signed webhook retries, replay/idempotency, amounts, order state, and duplicate/out-of-order events. The QA-only endpoint is deployed, but no authenticated payment or paid webhook has yet been exercised after v9.
4. Prove card monthly and annual subscriptions, renewal, failure, cancellation, and mixed-cycle traffic behavior in TEST; cancel test subscriptions and reconcile test data.
5. Exercise commercial trigger/outbox flows with a fake sink only; verify no mail, CRM fulfillment, or lead/implementation automation is sent from QA. Keep the 13 historical cancelled lead jobs cancelled; only verify a newly-created test lead without sending to an actual prospect.
6. Decide whether to suppress/document or remediate the reviewed RLS/RPC advisor findings; leaked-password protection remains a Supabase Auth hardening item. Re-run advisors after any security/schema change. Review the informational foreign-key/index findings separately before modifying indexes.
7. Complete a safe LIVE configuration validation and deploy/merge reviewed code with rollback. Do not automate a LIVE payment. The owner can then place a controlled real card payment manually if desired. Do not enable LIVE Pix/boleto before the full method-specific TEST gates and agreement on renewal semantics.
8. Confirm tax treatment and Brazilian invoice/NFS-e obligations with the accountant; do not enable automatic tax collection until registration and configuration are verified.

## Current customer guidance

Do **not** invite a customer to test a purchase from this branch yet. After the gates above, start with one owner-controlled low-value LIVE card transaction and verify the receipt, webhook, order reconciliation, customer email, and cancellation/refund path. Treat Pix as a one-time prepayment unless a distinct recurring mechanism is explicitly implemented; boleto invoices require individual manual payment and asynchronous bank settlement.
