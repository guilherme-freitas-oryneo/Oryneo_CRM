# WhatsApp SDR Conversation Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, audited per-conversation SDR on/off control to the CRM.

**Architecture:** A service-role-only PostgreSQL RPC performs the state transition, audit insert and pending-work cancellation atomically. The existing authenticated `whatsapp-inbox` function authorizes channel admins and invokes the RPC. The React inbox exposes an accessible contextual toggle with explicit consent confirmation.

**Tech Stack:** React 19, TypeScript, Vitest, Supabase Edge Functions, PostgreSQL 17/RLS.

**Spec:** `docs/superpowers/specs/2026-10-29-whatsapp-sdr-conversation-toggle-design.md`

## Global Constraints

- No direct browser mutation of conversation automation state.
- Activation requires explicit consent confirmation and rejects opted-out conversations.
- Deactivation preserves consent and cancels pending automatic work.
- No changes to Stripe, proposals, e-mail, pipeline or landing page.

## Review Focus

- Unauthorized operator cannot alter automation state.
- Opted-out conversation cannot be activated.
- Deactivation cancels queued, leased and retrying automatic work atomically.
- UI does not claim success before the backend responds.
- Mobile header keeps the state control reachable without overflow.

### Task 1: Atomic state transition and audit

**Files:**
- Create: `supabase/migrations/*_crm_whatsapp_sdr_conversation_toggle.sql`
- Create: `.github/scripts/qa-whatsapp-sdr-toggle.sql`

**Interfaces:**
- Produces: `crm_wa_set_automation_state(uuid, uuid, boolean, boolean)` returning the updated conversation mode and consent state.

- [ ] Write SQL QA for activation, opt-out rejection, deactivation cancellation and audit.
- [ ] Run QA and observe failure because the RPC does not exist.
- [ ] Add the additive migration with service-role-only grants and RLS audit table.
- [ ] Run SQL QA in PostgreSQL 17 and confirm pass.
- [ ] Commit.

### Task 2: Authenticated backend contract

**Files:**
- Modify: `supabase/functions/whatsapp-inbox/index.ts`
- Modify: `src/whatsapp/api.ts`
- Test: `src/whatsapp/WhatsAppWorkspace.test.tsx`

**Interfaces:**
- Consumes: Task 1 RPC.
- Produces: `setWhatsAppAutomation(conversationId, enabled, consentConfirmed)`.

- [ ] Add failing UI/API interaction test for activation and pausing.
- [ ] Verify focused test fails for the missing client function/control.
- [ ] Add the admin-only Edge action and typed client helper.
- [ ] Run type checks and focused tests.
- [ ] Commit.

### Task 3: Conversation control UI

**Files:**
- Modify: `src/whatsapp/WhatsAppWorkspace.tsx`
- Modify: `src/whatsapp/whatsapp.css`
- Modify: `src/whatsapp/WhatsAppWorkspace.test.tsx`

**Interfaces:**
- Consumes: `setWhatsAppAutomation`.
- Produces: accessible state control and consent confirmation in the thread.

- [ ] Extend failing tests for confirmation, loading, error and opt-out states.
- [ ] Implement the minimal state control and refresh behavior.
- [ ] Run focused tests, full suite and production build.
- [ ] Review desktop/mobile CSS for overflow and touch targets.
- [ ] Commit.
