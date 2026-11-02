# ORYNEO live runtime — execution plan

**Spec:** `/workspace/oryneo-zip-original/ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28/01_PROMPT_MESTRE_CODEX.md`

**Base:** `64187334d622a695164af992aa970f6715fa8bf5`

## Constraints

- Keep the existing WhatsApp, e-mail, proposal and Stripe paths operating until a channel has an evidenced, reversible cutover.
- No paid outbound delivery or real charge during tests.
- Treat Meta template approval, consent, authenticated provider events and release attestations as facts to verify, never values to fabricate.
- The graph executor remains the only source of automation decisions after a channel-specific cutover; shadow mode produces no external effect.

## Tasks

1. Reconcile the deployed executor, legacy owners, graphs, workers, events and release gates; encode the resulting invariants in readiness tests and an operator-facing diagnostic.
2. Replace zero-action published starter graphs with versioned, safe action-bearing drafts that use only existing guarded adapters and canonical references. Keep them disabled until their real prerequisites are met.
3. Complete the runtime orchestration path: durable event intake, serialized per-conversation work, explicit retry/handoff outcomes and scheduled bounded workers. Add no new external send path.
4. Run the automated homologation matrix in shadow mode, record real evidence, and make the release page show only the verifiable remaining gates.

## Completion criteria

- A published flow can contain guarded actions and the runtime can account for it without dispatching through an unapproved path.
- A received WhatsApp event has recoverable durable state, ordering protection, clear error and handoff outcomes.
- Shadow diagnostics expose flow/action/cursor/worker outcomes and fail closed when prerequisites are absent.
- Existing client-facing channels remain owned by the legacy executor until the strict release gates are actually satisfied.
