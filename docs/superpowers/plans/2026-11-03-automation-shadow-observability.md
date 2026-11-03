# Automation Shadow Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the eight operational v2 revisions in disabled shadow-safe form and make real CRM events observable without external actions.

**Architecture:** Preserve the immutable v1 snapshots and legacy ownership. Freeze each existing v2 review draft through the guarded publication RPC while the runtime is safely stopped, then restart only shadow observation. Make the worker report safe idle/degraded observation states as successful, sanitized outcomes; DB ingest remains cursor-bound, idempotent and fenced.

**Tech Stack:** Supabase Postgres/RPC, Supabase Edge Functions (Deno/TypeScript), React/Vite, Vitest and Deno tests.

**Spec:** User request, 2026-11-03; `docs/automation/STAGE6_RELEASE_EVIDENCE_20261102.md`.

## Global Constraints

- Do not enable a flow, transfer channel ownership, send a message/email, create a charge, mutate a CRM record, or change the landing page.
- Published versions are immutable; publication uses `automation_publish_disabled`, never direct pointer updates.
- Runtime remains `shadow`; `dispatchAuthorized` is always false.
- Observation payloads and logs contain only IDs, counters and fixed reason codes.
- Preserve all legacy providers and executors.

## Review Focus

- A denied internal RPC must produce a healthy, sanitized `200` shadow result, not a recurring `503`.
- An unexpected ingest failure must remain visible as a `503` and must not be reclassified as safe idle.
- Repeated source events must remain unique by `(workspace_id, source, event_id)`.
- Each of the eight frozen v2 revisions must stay disabled and point only to its own immutable snapshot.
- Shadow decisions for external-capable nodes must record `blocked` actions only and never dispatch.

---

### Task 1: Capture and codify worker safe-state classification

**Files:**
- Modify: `supabase/functions/automation-shadow-worker/index.ts`
- Create: `supabase/functions/automation-shadow-worker/safeState.ts`
- Test: `supabase/functions/tests/automation_shadow_safe_state_test.ts`

**Interfaces:**
- Produces: `shadowSafeState(error: unknown): { code: string } | null`.
- Consumes: Supabase RPC error codes without provider payloads.

- [ ] **Step 1: Write failing tests** for the known permission-denied shadow ingest state and for a generic error which must not be suppressed.
- [ ] **Step 2: Run the Deno test** and confirm the missing classifier fails.
- [ ] **Step 3: Implement `shadowSafeState(error: unknown)`** with a fixed allowlist of safe disabled/shadow reason codes; never read or return arbitrary error text.
- [ ] **Step 4: Update the worker** so safe no-op/degraded observation replies are `200`, fixed-code, `shadowOnly:true`, `dispatchAuthorized:false`; retain `503` for unexpected failures.
- [ ] **Step 5: Run focused Deno tests** and the automation test suite.

### Task 2: Publish operational revisions without enabling them

**Files:**
- Create: `supabase/migrations/20261103*_oryneo_operational_v2_disabled_publication.sql`
- Test: `supabase/functions/tests/automation_operational_v2_publication_test.ts`
- Modify: `docs/automation/2026-11-03-shadow-observation.md`

**Interfaces:**
- Consumes: the seeded v2 drafts, `automation_shadow_control`, and `automation_publish_disabled`.
- Produces: eight immutable v2 snapshots, all `enabled=false`, followed by restored shadow mode.

- [ ] **Step 1: Write failing structural tests** that assert all eight named v2 graphs have canonical triggers, explicit conditions, safe stop paths, internal `crm_task`, and no external transport node.
- [ ] **Step 2: Run the test** and confirm current publication state lacks the operational v2 snapshot contract.
- [ ] **Step 3: Implement an idempotent migration** that uses guarded RPCs to stop shadow, validates and freezes each exact draft, and restarts shadow only after all eight succeed; no direct publication-pointer update.
- [ ] **Step 4: Validate migration SQL locally** and run targeted tests.
- [ ] **Step 5: Apply production migration** and read back flow/version/runtime/ownership state.

### Task 3: Observe canonical source events and expose diagnosis

**Files:**
- Modify: `supabase/functions/automation-shadow-worker/index.ts`
- Modify: `supabase/functions/automation-api/index.ts`
- Modify: `src/automation/AutomationsWorkspace.tsx`
- Test: `supabase/functions/tests/automation_shadow_worker_test.ts`
- Test: `src/automation/AutomationsWorkspace.test.tsx`
- Modify: `docs/automation/2026-11-03-shadow-observation.md`

**Interfaces:**
- Consumes: existing cursor/lease/fencing RPCs and sanitized execution records.
- Produces: a single Automações dashboard view with observed event type/source, candidate flow, decision and fixed block reason.

- [ ] **Step 1: Write failing tests** for read-only observed-event diagnostics and no content/PII fields.
- [ ] **Step 2: Run tests** and confirm the view/API does not yet provide the required diagnostic contract.
- [ ] **Step 3: Implement a read-only server endpoint and consolidated UI panel** backed by inbox/execution/node/outbox metadata; do not add per-flow pages.
- [ ] **Step 4: Run focused tests, full unit suite and production build.**
- [ ] **Step 5: Deploy Edge Functions, perform read-only production validation and inspect logs for successful shadow cron calls.**

### Task 4: Audit and hand off

**Files:**
- Modify: `docs/automation/2026-11-03-shadow-observation.md`

- [ ] **Step 1: Query read-only operational evidence** for CRM intake, opportunities, proposal, checkout, payment, mail and WhatsApp source readiness; query Stripe only through read-only provider records.
- [ ] **Step 2: Record exact proof, known limits and non-homologated gates** without asserting client consent, payment, provider delivery, or canary results.
- [ ] **Step 3: Run advisors and final regression commands.**
- [ ] **Step 4: Commit, push, open PR, wait for checks, merge and verify deployed production readbacks.**
