# ORYNEO ZIP Completion Implementation Plan

> **For agentic workers:** Execute each task in order in this isolated branch. Keep the new runtime off until every release gate has independent evidence. Use the checkpoint to record before/after scores, SHA, environment and test result.

**Goal:** Complete the 28 October Automações/SDR/Pipeline package with usable visual editing and safe multichannel execution, while preserving the existing commercial and financial paths.

**Architecture:** The editor saves versioned graph definitions. A server compiler turns immutable, published graphs and canonical events into fenced, durable actions. Each channel has one owner and one executor; provider effects are reconciled from receipts. Release attestations and the emergency stop control activation.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Supabase Postgres/Edge Functions (Deno), PostgreSQL 17 QA, Playwright, GitHub Actions.

**Spec:** `docs/automation/ZIP_CHECKPOINT_MASTER_20261031.md`, `qa/acceptance/checkpoint-master-20261031.json`, `docs/automation/ZIP_COMPLETION_EXECUTION_CHECKPOINT_20261031.md`, and the audited 28 October ZIP. The ZIP itself is not present in this execution environment; these versioned audits preserve its 70 criteria and 47 acceptance IDs.

## Global Constraints

- Preserve legacy WhatsApp/SDR, Stripe, refund, proposal, email and trigger behavior until a channel-specific cutover is proven; leave the landing page out of scope.
- A verified Stripe order is the only source for payment completion. A graph, lead message or UI flag cannot assert payment.
- Simulation, preview and draft changes cause no external message, payment or CRM mutation.
- Unknown consent, opt-out, Meta policy, provider result or release evidence fails closed. Never infer marketing consent from a conversation.
- The new runtime remains `disabled` with `emergency_stop=true` until legal, playbook, rollback, security, authenticated E2E and channel-specific gates are documented and attested.
- Keep the 70-item checkpoint fixed. A passing isolated test does not become live acceptance evidence.

## Review Focus

1. Concurrent workers claim the same action: one fenced effect, stale claim rejected. Test in Task 2.
2. Provider timeout after POST: keep outcome uncertain and reconcile before any retry. Test in Task 3.
3. Inbound reply during follow-up wait: cancel by conversation before dispatch. Test in Task 2.
4. Paid order arrives twice or is refunded: no duplicate or premature delivery project/stage change. Test in Task 4.
5. A non-consented contact enters any journey: no outbound action, including marketing templates and email. Test in Task 3.

---

### Task 1: Lock the source of truth and publishable graph contract

**Files:** `src/automation/flowPublication.ts`, `supabase/functions/automation-api/graphGuard.ts`, `supabase/functions/automation-api/index.ts`, `src/automation/runtimeReadiness.ts`; tests alongside these modules; checkpoint files.

**Interfaces:** Immutable `automation_flow_versions` and `automation_flows.published_version_id`; one server validation result used by editor and release. Node capabilities must derive from server support, not UI optimism.

- [ ] Add graph contract tests for all 17 node types, immutable hash, invalid edge, unsupported action, role and release gate.
- [ ] Align client/server validation, then run Vitest, Deno tests and PostgreSQL QA; reject any publish that contains a live action without an executor.
- [ ] Make the editor explain capability and publication errors at the affected node; test keyboard, touch and saved/reopened graph.
- [ ] Record criterion deltas only after the relevant server and UI evidence exists; commit the contract and tests.

### Task 2: Complete durable execution and wait continuation

**Files:** `supabase/functions/automation-live-crm-plan-worker/index.ts`, `supabase/functions/automation-shadow-worker/index.ts`, `supabase/functions/automation-api/executionKernel.ts`, new versioned migrations under `supabase/migrations/`, PostgreSQL QA scripts.

**Interfaces:** `automation_event_inbox` → immutable flow → `automation_executions`/`automation_action_outbox`; wait timer resumes through a single fenced continuation. No channel side effect in the planner.

- [ ] Write failing SQL/Deno tests for duplicate events, simultaneous claims, stale lease, reply cancellation, due timer and worker crash.
- [ ] Implement versioned live wait registration, claim and continuation with a release preflight immediately before scheduling an action.
- [ ] Reconcile CRM action receipts and recover after crash without repeating a completed mutation.
- [ ] Replay migrations on PostgreSQL 17, run worker tests, check RLS/grants/advisors, and commit.

### Task 3: Complete channel executors and opt-out proof

**Files:** `supabase/functions/automation-meta-template-worker/index.ts`, `supabase/functions/automation-api/commercialActionPolicy.ts`, new email/SDR channel workers and shared adapter modules, migrations, Deno/SQL contract tests.

**Interfaces:** Each executor consumes a fenced outbox claim; checks current owner, consent, opt-out, provider policy and published node; writes a provider receipt or `uncertain`. No blind retry after a possible provider effect.

- [ ] Write failing tests for no consent, revoked consent, human takeover, expired Meta window, provider timeout, duplicated claim and release revocation.
- [ ] Add purpose-specific verified consent storage and a CRM read/revoke path; never expose secret tokens or unrestricted service role to the browser.
- [ ] Implement email and WhatsApp dispatch through existing provider adapters with canonical recipient and approved content; implement SDR continuation behind the same single-owner gate.
- [ ] Test provider sandbox/fixtures, security, cost bounds and reconciliation; commit without enabling live ownership.

### Task 4: Bridge commercial pipeline and post-sale

**Files:** `src/automation/postSaleStage.ts`, `supabase/migrations/`, existing `crm_schedule_implementation_automation` dependency, `supabase/functions/automation-api/commercialAdapterPlanner.ts`, pipeline QA.

**Interfaces:** The verified paid order creates exactly one post-sale delivery project; commercial `Ganha` and operational `Implantação` retain historical identifiers until a reversible bridge is proven.

- [ ] Write failing tests for paid/refunded/replayed events, old-stage records, two won stages, legacy trigger compatibility and rollback.
- [ ] Implement additive mapping/bridge, migrate only after read-only impact analysis and a checked backup; keep the old trigger working during the transition.
- [ ] Prove idempotency and rollback in a database copy; then enable the UI separation only when hosted counts and trigger references match the tested state.
- [ ] Run Stripe, proposal, refund, email and checkout regressions; commit the bridge and evidence.

### Task 5: Deliver eight operational starter journeys and knowledge release

**Files:** `src/automation/starterFlows.ts`, `src/automation/safeStarterActionPlans.ts`, `src/automation/SdrIntelligencePanel.tsx`, `supabase/functions/automation-api/`, acceptance fixtures and tests.

**Interfaces:** First contact, conversation, checkout, verified payment, diagnosis, proposal and follow-up use the same published graph contract. Knowledge/playbook and intent dictionary are immutable releases referenced by hash.

- [ ] Turn each starter into a complete graph with explicit stop/handoff, consent, wait and channel actions; keep draft variants non-sending until publication.
- [ ] Test every positive, negative, duplicate, opt-out and cancelled follow-up path against the server compiler.
- [ ] Simplify the CRM editing experience around a readable journey, focused inspector and one coherent SDR knowledge/attachments area; verify mobile and desktop.
- [ ] Compare business copy, template bindings and legal/financial claims with approved sources; publish only a reviewed knowledge version and commit.

### Task 6: Authenticate, observe, release and recover

**Files:** `qa/acceptance/`, `.github/workflows/qa-oryneo-automations.yml`, `docs/automation/`, release/rollback scripts and evidence.

**Interfaces:** `automation_release_missing_gates` remains the authoritative gate list. Activation occurs per channel only after a canary, single-owner proof and documented recovery.

- [ ] Re-run all 47 acceptance IDs with evidence type marked isolated or live; capture a real authenticated editor session at 390/768/1440 px.
- [ ] Exercise one controlled canary for each authorized channel, inspect provider receipt, latency, cost and logs; verify no duplicate legacy dispatch.
- [ ] Exercise restoration of Edge bundle, graph version, channel ownership, frontend and database state in a safe environment; document timing and owner.
- [ ] Obtain independent legal/commercial and operational evidence for remaining gates; then activate incrementally, monitor, and update the 70 criteria only from observed facts.

## Current checkpoint (01/11/2026)

PR #83 is on `main`; PR #82 remains a draft. This branch merges both and passes 568 Vitest tests and `npm run build`. Hosted Supabase remains `disabled`/`emergency_stop=true`, with 8 drafts, 0 published, 0 executions, 0 attestations, and all five channel owners `legacy`. No live dispatch or cutover is authorized by this plan alone.

### Evidence update: 01/11/2026

- Static Meta templates: `metaTemplateRequest`, `templateBindings` and the Meta worker now agree that an approved BODY with zero placeholders needs no synthetic parameter; 17 targeted Deno tests and the production build passed. The hosted registry currently has 44 approved templates, all with 1–4 parameters, so this is forward compatibility and does **not** increase the 70-item score.
- Deno package resolution is pinned in `deno.lock`. The first PR #84 Edge check failed while resolving a newly published transitive Rollup binary under Deno's minimum age policy; a frozen local check passed with the pinned older version, and the subsequent Edge check passed in GitHub Actions.
- The live post-sale read-only probe still finds one hard-coded reference to the `Implantação` stage, two `won` stages, zero active deals in `Implantação`, and zero delivery projects. No migration or stage mutation was performed.
- A fresh Drive search found the existing terms **minuta v0.9** and the 19 October internal legal release matrix; it found no newer approved terms under the ORYNEO terms query. The legal gate remains open.
