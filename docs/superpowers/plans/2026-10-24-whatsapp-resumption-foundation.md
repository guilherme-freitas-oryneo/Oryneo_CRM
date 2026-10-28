# WhatsApp Resumption Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the verified resume point and add a tested server-side policy foundation without activating WhatsApp or changing production.

**Architecture:** Keep current `wa.me` flows. Add pure policy functions under Supabase shared code, with Vitest importing and exercising the same module. Do not create resources in Supabase or Meta until account inventory and reconciliation of possible office changes.

**Tech Stack:** React/TypeScript, Vitest, Supabase Edge Functions (Deno), PostgreSQL.

**Spec:** `docs/whatsapp/CONTINUIDADE_CODEX.md` and the user's attached original master prompt.

## Global Constraints

- No change to landing rebranding, finance, number registration, production webhook or active provider.
- No real messages or private data in test fixtures.
- Keep the policy on the server path; frontend validation is advisory only.

## Review Focus

- A queued automation sees a human lock before the final send and must refuse.
- `review` must not emit automatically.
- Opt-out must refuse automated and human sends until an authorized workflow changes consent.
- A freeform send outside the service window must refuse, while an approved template remains eligible.
- Out-of-order delivery webhooks must not downgrade `read`.

### Task 1: forensic checkpoint

**Files:** Create `docs/whatsapp/CONTINUIDADE_CODEX.md`, `docs/whatsapp/02-ARCHITECTURE-ADR.md`.

**Interfaces:** Produces the evidence and gates for later implementation.

- [x] Record GitHub, Supabase, Meta/MCP and deployment observations with limits.
- [x] Map each master section 00–21 and the next step.
- [x] Verify `git diff --check` and commit the checkpoint.

### Task 2: outbound policy and delivery state

**Files:** Create `supabase/functions/_shared/whatsapp/policy.ts`; test `src/whatsapp/policy.test.ts`.

**Interfaces:** Produces `evaluateOutboundPolicy(input): {allowed: true} | {allowed: false; reason: string}` and `advanceDeliveryStatus(current, incoming): DeliveryStatus`. These are pure functions for later Edge Function integration; they do not themselves authorize a database operation.

- [x] Write tests for lock, review, opt-out, disabled channel, 24h window, template approval and status order.
- [x] Run the focused test and observe failure because the module is absent.
- [x] Implement minimal pure functions, then run focused test, full test suite, and build.
- [x] Record that backend integration, database enforcement and live E2E remain pending; commit the code and tests.
