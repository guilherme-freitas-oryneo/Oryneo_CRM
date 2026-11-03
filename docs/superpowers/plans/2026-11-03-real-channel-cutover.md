# ORYNEO — real channel delivery plan

**Spec:** `ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28/01_PROMPT_MESTRE_CODEX.md`

## Constraints

- Preserve the live legacy worker until a single replacement channel has passed its controlled cutover.
- Never create a charge, template send, e-mail send, payment event, or legal evidence during testing.
- Provider verification, consent, terms, playbook approval, authenticated canary and rollback evidence must be factual and reviewable.

## Work sequence

1. Reconcile the deployed legacy WhatsApp SDR, its durable queue, provider state, template registry and actual failure handling against the acceptance matrix.
2. Make the new automation graphs operationally complete as versioned drafts: canonical triggers, internal CRM actions, approved-template/email placeholders and explicit stop conditions.
3. Implement consent capture and evidence plumbing in the live intake/proposal paths, without backfilling or assuming consent for existing contacts.
4. Bind approved e-mail templates and the active mailbox into the new engine using server-side revalidation and durable receipts.
5. Publish the playbook and semantic releases only when their hashes match the approved commercial source; preserve the current legacy SDR until then.
6. Add a channel-by-channel release console that exposes real provider, consent, rollback, canary and single-owner status, with no bypass control.
7. Execute a zero-cost controlled canary only through an already eligible path; promote a channel only when the server interlocks accept genuine evidence.

## Completion

All functional paths are ready in production. Each external delivery remains server-gated by current consent, provider verification, owner exclusivity and release evidence. Existing client service continues without interruption until its replacement has been verified.
