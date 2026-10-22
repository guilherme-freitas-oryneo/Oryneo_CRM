# ORYNEO CRM billing center

## Goal

Give the CRM team one billing view inside each client record. It shows the contracted plan, cycle, start date, next renewal date and any paid traffic service period. Card plans renew by subscription; Boleto creates a recurring subscription that emails a new invoice each period and requires the customer to pay each invoice manually. Near a due date, a team member can create a one-time Pix or assisted Boleto charge when needed, send its link by email, and copy the same link for WhatsApp. A paid event advances the relevant period only after Stripe webhook reconciliation.

## Current baseline

- `crm_billing_orders` already stores the accepted proposal snapshot, order items, customer, paid time, Stripe subscription IDs and traffic renewal state.
- `crm_billing_obligations` already stores per-competence one-time Pix/boleto obligations and is service-role-only.
- `DealDetails` has Overview, History, and Proposal tabs, but no billing center.
- `billing-recurring-worker` is an incomplete experiment. It has no owner-facing charge creation action, uses the commercial order/job tables, creates unconfigured Checkout Sessions, and has no verified billing email processor. Do not deploy or schedule it.
- The public checkout currently ignores its parsed payment-method field and hard-gates non-card LIVE. Card funding selection is absent.

## Product behavior

1. Add a `Cobrança` view to the client record and expand the contract details in place.
2. Show the latest paid contract/order, plan and cycle, paid start date, plan's next charge date, traffic start/end and quarterly renewal date, current card subscription status, and each open/paid/failed Pix or boleto competence.
3. The team selects service (plan or traffic), method (Pix or boleto) and due date. The server derives amount from the stored accepted order/catalog; the browser never supplies an authoritative price.
4. Clicking `Gerar cobrança e enviar e-mail` creates a one-time Stripe Checkout Session bound to one obligation competence, persists its provider ID idempotently, sends one email through the CRM outbox, and lets staff copy the same Stripe-hosted URL for WhatsApp. TEST deliveries go only to a configured internal sink.
5. Duplicate clicks/retries return the same open attempt and never send duplicate email. A failed or expired attempt can be replaced while retaining its audit history.
6. Signed, mode-checked Stripe events update only the matching obligation. Pending/created boleto or Pix is not paid; payment status and contract dates update only after provider settlement is reconciled.
7. Card checkout offers credit and debit as real choices. The selection is applied server-side using the Checkout Session `payment_method_options.card.restrictions.funding_types_blocked` parameter, supported by Stripe API version `2026-08-26.dahlia`. The merchant-authoritative order total stays visible and cannot be changed by the buyer.
8. Card subscriptions remain server-priced. Boleto subscriptions issue an invoice each period with manual customer settlement; the CRM can also create a one-time assisted charge for an exceptional collection. Pix renewals are explicit one-time charges created from the CRM, not Pix Automático.

## Security and environment rules

- Every CRM action requires a valid member JWT and membership check server-side.
- Service/order/obligation tables remain unavailable to browser writes. Edge Functions use the service role only after member and order ownership checks.
- Payment amount, currency, competence, order ID, environment, recipient and Stripe price/session IDs are resolved or validated server-side.
- TEST payments and mail are isolated. Never create or send a LIVE payment/email during homologation.
- Stripe webhook HMAC over the raw body, `livemode`, session/order/obligation identity, amount and currency are mandatory. Event writes remain idempotent and monotonic.
- Keep public Checkout session/link URLs out of logs; store and display them only to the authorized member and intended recipient.

## Open interpretation pending owner response

The customer-entered card amount could mean either payment details or a variable charge. Until clarified, preserve the accepted CRM order total and allow only card-data entry. If variable charging is required, the CRM must authorize a bounded amount/partial-payment contract before the buyer sees it; never accept an arbitrary browser-supplied amount.

## Implementation sequence

1. Add pure policy tests for billing periods and server-derived plan/traffic amounts.
2. Add migration for contract period snapshots and payment attempt/email outbox audit, with RLS and service-only mutation.
3. Add authenticated billing-center Edge Function for list/prepare/send/copy link actions; never deploy it to LIVE before TEST gates.
4. Extend isolated webhook matching for every attempt and update plan/traffic dates only on verified payment.
5. Add CRM billing view and checkout credit/debit selection with accessible controls and exact total/renewal text.
6. Extend the existing mail worker through a typed fake-sink test path and idempotent outbox templates for payment instructions/reminders/receipts.
7. Run Vitest, Deno, build, migration/advisor checks, then deploy only isolated TEST functions and smoke without a LIVE session. Publish a draft preview after the implementation commit passes CI.

## Current implementation notes

- The CRM billing tab, authenticated billing-center function, server-calculated one-time Pix/boleto charges, idempotent CRM outbox email send, and link copy are implemented locally. The function uses the order's billing environment; test emails go only to `BILLING_TEST_EMAIL_SINK`.
- The obligation uniqueness migration now prevents two payment methods from creating parallel charges for the same service competence.
- A failed/expired Checkout Session cannot yet be replaced while preserving attempt history. Add an attempt table and update webhook reconciliation before enabling retries.
- The direct public checkout offers card credit, card debit, and recurring Boleto invoices locally. Stripe enforces card funding choice on the Checkout Session and Boleto subscriptions use `send_invoice`; neither has yet been smoke-tested through a settled live purchase.
- The CRM proposal checkout asks the buyer for credit/debit on the payment page. The server expires the unconfirmed session and recreates it with that funding restriction before mounting the card fields.
- Stripe reference: [funding-type restrictions in Checkout Sessions](https://docs.stripe.com/changelog/dahlia/2026-08-26/adds-card-funding-type-filtering-to-checkout-sessions).
- The new migration and function are not applied/deployed. Local edge-function type checks and the full Deno suite pass; database migration/advisor checks and an isolated Stripe smoke remain outstanding.
