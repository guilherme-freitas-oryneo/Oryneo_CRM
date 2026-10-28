# WhatsApp SDR Durable Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every eligible WhatsApp inbound message produce a durable, idempotent SDR job whose generation, sending, failure and human handoff remain recoverable without adding a paid service.

**Architecture:** The signed webhook persists the inbound message and enqueues one AI job in the same durable path, then returns without calling OpenAI or Meta. A dedicated Edge Function claims leased jobs, applies current conversation and channel guards, generates a response, writes a separate send outbox, and reconciles Meta delivery with bounded retries and explicit review states. Existing Supabase Postgres, Edge Functions and scheduled HTTP facilities are reused; live scheduling and deployment remain outside this branch.

**Tech Stack:** TypeScript, Deno Edge Functions, Supabase Postgres/RLS, Vitest, existing WhatsApp Cloud API adapter.

**Spec:** `docs/whatsapp/SDR_DURABLE_RECOVERY_DESIGN_20261028.md`

## Global Constraints

- No paid Supabase branch, queue provider, hosted worker, model call or WhatsApp send is created during implementation or QA.
- Do not change Stripe, refunds, billing, proposals, transactional email, landing page or their triggers.
- A conversation is automatically eligible only when its mode is `sdr_active`, it is not opted out and global AI mode is `auto`.
- `review`, `human_locked`, `resolved` and opted-out conversations never generate or send an automatic response.
- Webhook duplicates must map to one inbound message and at most one AI job.
- OpenAI `incomplete`, empty output, 429, 5xx and timeouts are recoverable classifications; authentication/configuration failures stop in human review.
- Every external send has a stable idempotency key and an explicit uncertain-outcome state.
- Templates remain read-only and unavailable for live flow use while Meta reports `PENDING`.
- Production deployment, cron activation, real messages and merge require a later explicit release checkpoint.

## Review Focus

- Duplicate signed webhook while a job is queued or leased: one job and one possible send.
- Human takeover between generation and sending: cancel the pending outbox before Meta is called.
- Provider HTTP 200 with `incomplete` or no text: retry with a durable reason, then require review.
- Meta timeout after request dispatch: mark outcome uncertain and reconcile instead of blindly resending.
- Three inbound messages arriving quickly: serialize by conversation and supersede stale unsent replies.

---

### Task 1: Provider result contract

**Files:**
- Modify: `supabase/functions/_shared/whatsapp/aiProvider.ts`
- Modify: `src/whatsapp/aiProvider.test.ts`

**Interfaces:**
- Produces: `requestAiReply(input, fetcher): Promise<AiReplyResult>` with `text`, `providerResponseId`, and terminal or retryable error codes through `AiProviderError`.
- Consumes: existing OpenAI Responses and Anthropic Messages request inputs.

- [x] **Step 1: Write failing tests for OpenAI `incomplete`, empty output, 429, 5xx, timeout and a successful nested text block.**
- [x] **Step 2: Run `npm test -- --run src/whatsapp/aiProvider.test.ts` and verify the new cases fail for missing structured outcomes.**
- [x] **Step 3: Implement typed provider results and errors, parse response status/details without logging response bodies, and keep keys only in headers.**
- [x] **Step 4: Run the focused test and the full Vitest suite.**
- [x] **Step 5: Commit the provider contract.**

### Task 2: Durable job and send outbox schema

**Files:**
- Create: `supabase/migrations/20261028213000_crm_whatsapp_ai_durable_queue.sql`
- Create: `.github/scripts/qa-whatsapp-ai-queue.sql`
- Modify: `.github/workflows/qa-crm-v21.yml`

**Interfaces:**
- Produces: tables `crm_wa_ai_jobs` and `crm_wa_ai_outbox`; RPCs `crm_wa_enqueue_ai_job`, `crm_wa_claim_ai_jobs`, `crm_wa_complete_ai_generation`, `crm_wa_claim_ai_outbox`, `crm_wa_finish_ai_send`.
- Consumes: `crm_wa_channels`, `crm_wa_conversations`, `crm_wa_messages`, `crm_members`, service-role-only execution.

- [ ] **Step 1: Write SQL QA transactions proving dedupe, lease exclusivity, state constraints, conversation serialization, retry scheduling, takeover cancellation and RLS denial.**
- [ ] **Step 2: Run the QA against an isolated disposable PostgreSQL database and verify failure because the objects do not exist.**
- [ ] **Step 3: Add the additive migration with service-role-only grants, RLS, unique inbound/outbox keys and bounded attempts.**
- [ ] **Step 4: Re-run SQL QA and Supabase advisors against the isolated schema; do not apply it to production.**
- [ ] **Step 5: Commit the durable schema and QA gate.**

### Task 3: Webhook enqueue boundary

**Files:**
- Modify: `supabase/functions/_shared/whatsapp/persistEvent.ts`
- Modify: `src/whatsapp/persistEvent.test.ts`

**Interfaces:**
- Consumes: `crm_wa_enqueue_ai_job(conversation_id, inbound_message_id)` from Task 2.
- Produces: webhook persistence that records/enqueues before setting the raw event to `processed`, with no provider or Meta calls.

- [ ] **Step 1: Write failing tests proving eligible text enqueues before processed, review/reaction/media do not enqueue, and enqueue failure leaves the raw event retryable.**
- [ ] **Step 2: Run the focused test and verify the old inline reply path fails the assertions.**
- [ ] **Step 3: Remove inline generation/sending and enqueue through the service RPC after message persistence.**
- [ ] **Step 4: Run focused and full suites plus Deno check for `whatsapp-webhook`.**
- [ ] **Step 5: Commit the webhook boundary.**

### Task 4: AI generation worker

**Files:**
- Create: `supabase/functions/whatsapp-ai-worker/index.ts`
- Create: `supabase/functions/_shared/whatsapp/aiJobProcessor.ts`
- Create: `src/whatsapp/aiJobProcessor.test.ts`
- Modify: `.github/workflows/ci-crm-v2.yml`

**Interfaces:**
- Consumes: Task 1 provider contract and Task 2 claim/complete RPCs.
- Produces: `processAiJob(job, dependencies): Promise<AiJobDecision>` and an authenticated worker endpoint that uses bounded batches.

- [ ] **Step 1: Write failing tests for `sdr_active`, review, human takeover, opted out, stale job supersession, retryable provider errors and terminal review.**
- [ ] **Step 2: Run the focused test and verify failure because the processor does not exist.**
- [ ] **Step 3: Implement guard revalidation, sanitized context assembly, generation and durable outbox creation without sending.**
- [ ] **Step 4: Add the Edge Function entry point with existing cron-secret authentication pattern and a maximum batch size.**
- [ ] **Step 5: Run focused/full tests and Deno check, then commit.**

### Task 5: Meta outbox dispatcher and reconciliation

**Files:**
- Create: `supabase/functions/_shared/whatsapp/aiOutboxProcessor.ts`
- Create: `src/whatsapp/aiOutboxProcessor.test.ts`
- Modify: `supabase/functions/whatsapp-ai-worker/index.ts`

**Interfaces:**
- Consumes: Task 2 outbox claims and existing `buildOutboundMessage`.
- Produces: `processAiOutboxItem(item, dependencies): Promise<AiSendDecision>` with sent, retry, uncertain, cancelled and human-review outcomes.

- [ ] **Step 1: Write failing tests for successful send, policy cancellation, 429/5xx backoff, authentication failure and timeout-after-dispatch uncertainty.**
- [ ] **Step 2: Run the focused test and verify failure because the dispatcher does not exist.**
- [ ] **Step 3: Implement a single guarded Meta attempt per lease and persist the provider message ID before recording CRM read-model state.**
- [ ] **Step 4: Run focused/full tests and Deno check, then commit.**

### Task 6: Operational diagnosis and release evidence

**Files:**
- Modify: `supabase/functions/whatsapp-ai-settings/index.ts`
- Modify: `src/settings/api.ts`
- Modify: `src/settings/GeneralSettings.tsx`
- Modify: `src/settings/GeneralSettings.test.tsx`
- Create: `docs/whatsapp/SDR_DURABLE_RECOVERY_DESIGN_20261028.md`
- Create: `docs/whatsapp/SDR_DURABLE_RECOVERY_QA_20261028.md`

**Interfaces:**
- Consumes: queue/outbox aggregate states with no message bodies or customer identifiers.
- Produces: an administrator-only health summary and documented deployment/rollback gate.

- [ ] **Step 1: Write failing UI/API tests for queued, retrying, uncertain and human-review counts and a no-PII response contract.**
- [ ] **Step 2: Run focused tests and verify the diagnosis section is absent.**
- [ ] **Step 3: Add the aggregate endpoint and compact settings panel without adding a new sidebar section.**
- [ ] **Step 4: Document architecture, invariants, migration order, rollback and the fact that production remains unchanged.**
- [ ] **Step 5: Run Vitest, build, Deno checks, SQL QA and existing payment/proposal/email regression suites.**
- [ ] **Step 6: Review the complete diff against `origin/main`, record remaining release gates and commit.**
