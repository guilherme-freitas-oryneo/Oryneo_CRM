# Proposal Tangibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add concrete, consistent descriptions of every purchased item to the proposal email, secure proposal and printable PDF view.

**Architecture:** A shared billing presentation builder converts the verified quote and lead priority into a versioned, immutable presentation object stored in the proposal snapshot. The email and public proposal render that same object, while older snapshots keep their existing fallback rendering.

**Tech Stack:** TypeScript, Deno Edge Functions, React, Vitest, Supabase.

**Spec:** `docs/superpowers/specs/2026-10-24-proposal-tangibility.md`

## Global Constraints

- Do not add runtime dependencies.
- Do not invent delivery quantities, deadlines, channels, revisions, SLAs or performance outcomes.
- Keep email text selectable, accessible and functional when remote images are blocked.
- Keep secure URLs, proposal versioning and acceptance hashing unchanged.

## Review Focus

- Missing primary goal must render naturally without empty labels.
- Unselected add-ons must never appear.
- User-controlled text must be escaped in email HTML.
- Old snapshots without presentation data must remain readable and acceptable.
- Print output must exclude form controls while retaining commercial conditions.

---

### Task 1: Versioned delivery presentation

**Files:**
- Create: `supabase/functions/_shared/billing/presentation.ts`
- Modify: `supabase/functions/_shared/billing/catalog.ts`
- Test: `supabase/functions/tests/proposal_presentation_test.ts`
- Test: `src/billing/catalog.test.ts`

**Interfaces:**
- Produces: `buildProposalPresentation(quote, primaryGoal)` and `ProposalPresentation`.

- [ ] Write failing tests for plan limits, conditional cards and factual commercial notes.
- [ ] Run the focused tests and verify failure.
- [ ] Implement the catalog metadata and presentation builder.
- [ ] Run the focused tests and verify success.

### Task 2: Snapshot and personalized email

**Files:**
- Modify: `supabase/functions/proposal-create/index.ts`
- Modify: `supabase/functions/_shared/mail/transactional-templates.ts`
- Test: `supabase/functions/tests/system_transactional_test.ts`

**Interfaces:**
- Consumes: `ProposalPresentation` from Task 1.
- Produces: proposal snapshots and email input carrying the same presentation object.

- [ ] Write failing tests for priority, delivery cards, prices and HTML escaping.
- [ ] Run the focused tests and verify failure.
- [ ] Store the presentation in the snapshot and render it in HTML and plain text.
- [ ] Run the focused tests and verify success.

### Task 3: Tangible secure proposal and PDF view

**Files:**
- Modify: `src/proposal/ProposalPage.tsx`
- Modify: `src/proposal/proposal.css`
- Test: `src/proposal/ProposalPage.test.tsx`

**Interfaces:**
- Consumes: optional `snapshot.presentation` from Task 2.
- Produces: delivery cards, operating journey and `Imprimir ou salvar em PDF` action.

- [ ] Write failing tests for concrete cards, add-on visibility and print action.
- [ ] Run the focused tests and verify failure.
- [ ] Implement the accessible proposal sections and print stylesheet.
- [ ] Run the focused tests and verify success.

### Task 4: Release verification

**Files:**
- Modify only if a verification failure requires a fix.

- [ ] Run all frontend and Deno tests, Deno typecheck, production build and diff check.
- [ ] Review the final diff against the specification.
- [ ] Deploy the affected Edge Function, commit, push and verify the production artifact without sending customer email.
