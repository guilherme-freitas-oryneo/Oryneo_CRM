# ORYNEO Email Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a caixa `contato@oryneo.com.br` dentro do CRM ORYNEO, com envio imediato, sincronização IMAP bidirecional a cada minuto, interface responsiva e deploy homologado.

**Architecture:** O GitHub Pages continua servindo apenas React estático. Postgres/RLS/Storage/Realtime formam o estado local; `mail-sync` reconcilia IMAP em lotes via Cron e `mail-api` executa ações autenticadas e SMTP. Credenciais ficam no Vault e só uma função revogada para clientes, concedida à `service_role`, pode lê-las.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest, Testing Library, Supabase Postgres/Auth/RLS/Storage/Realtime/Cron/Edge Functions (Deno 2.1), TLS IMAP 993, TLS SMTP 465, PostalMime fixado por versão.

**Spec:** `docs/superpowers/specs/2026-10-12-email-inbox-design.md`

## Global Constraints

- Projeto Supabase exclusivo: `ucikrafwfzamxvweuvgk`; frontend: `guilherme-freitas-oryneo/Oryneo_CRM`.
- Nenhuma senha, token, chave administrativa, corpo de e-mail ou cabeçalho sensível pode ser commitado ou registrado em logs.
- IMAP usa `imap.hostinger.com:993` com TLS; SMTP usa `smtp.hostinger.com:465` com TLS; porta 587 não é fallback no Supabase.
- Toda tabela pública nova recebe RLS e `GRANT` explícito; toda função `SECURITY DEFINER` revoga `PUBLIC`, `anon` e `authenticated` e fixa `search_path`.
- Ações do navegador exigem sessão válida e associação em `crm_members`; sincronização interna exige segredo de Cron comparado por hash constante.
- Listas são paginadas no servidor; HTML é sanitizado, imagens remotas começam bloqueadas e anexos usam Storage privado/URL assinada curta.
- Cada página contém no máximo 50 threads; cada ciclo processa no máximo 25 mensagens por pasta e para aos 120 segundos; mensagens acima de 25 MiB ficam disponíveis inicialmente apenas por metadados.
- A composição aceita no máximo 15 MiB por anexo e 20 MiB agregados; URLs assinadas expiram em 60 segundos.
- Dependências são fixadas em versão exata e o lockfile é commitado.
- A publicação só ocorre após testes, build, typecheck Deno, Advisors e teste real controlado da Hostinger.

## Review Focus

- Literal IMAP fragmentado em múltiplos pacotes deve ser remontado sem truncar ou interpretar bytes do corpo como resposta; coberto na Task 2.
- Retry após SMTP aceitar a mensagem deve detectar o `Message-ID` em Enviados e não reenviar; coberto na Task 5.
- Mudança de `UIDVALIDITY` deve reconstruir localizações sem duplicar mensagens; coberto nas Tasks 3 e 4.
- Usuário autenticado não membro e usuário anônimo não podem ler tabelas, anexos ou chamar operações; coberto nas Tasks 3 e 5.
- HTML malicioso e imagens rastreadoras não podem executar/carregar antes do consentimento; coberto na Task 6.

---

### Task 1: Harness de testes e contratos compartilhados

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/mail/types.ts`
- Create: `src/mail/format.ts`
- Test: `src/mail/format.test.ts`

**Interfaces:**
- Produces: `MailAddress`, `MailFolder`, `MailThreadSummary`, `MailMessage`, `MailAttachment`, `MailDraft`, `MailSyncStatus`, `normalizeSubject(subject)`, `formatMailDate(value, now)`, `participantLabel(address)`.

- [ ] **Step 1: Write failing formatting and normalization tests**

Test `Re:`, `Fwd:` and localized prefixes, empty names, same-day dates, prior-year dates and invalid dates in `src/mail/format.test.ts`.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --run src/mail/format.test.ts`
Expected: FAIL because the mail modules do not exist.

- [ ] **Step 3: Add the pinned test stack and implement contracts**

Add scripts `test`, `test:watch` and exact versions of Vitest, jsdom, Testing Library and DOMPurify. Configure jsdom/setup and implement the exported types/functions.

- [ ] **Step 4: Run tests and build**

Run: `npm test -- --run src/mail/format.test.ts && npm run build`
Expected: PASS and Vite build completes.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/test src/mail
git commit -m "test: establish mailbox contracts"
```

### Task 2: Núcleo MIME, IMAP e SMTP testável

**Files:**
- Create: `supabase/functions/_shared/mail/protocol.ts`
- Create: `supabase/functions/_shared/mail/mime.ts`
- Create: `supabase/functions/_shared/mail/transport.ts`
- Create: `supabase/functions/_shared/mail/deps.ts`
- Test: `supabase/functions/tests/mail_protocol_test.ts`
- Test: `supabase/functions/tests/mail_mime_test.ts`

**Interfaces:**
- Produces: `ImapFrameReader.push(bytes)`, `quoteImap(value)`, `parseListResponse(line)`, `parseSelectState(lines)`, `parseFetchFrames(frames)`, `normalizeMessage(raw)`, `buildMimeMessage(input)`, `ImapClient`, `SmtpClient`.
- Consumes: Web/Deno APIs only; `PostalMime` imported at one exact version through `deps.ts`.

- [ ] **Step 1: Write failing protocol tests**

Cover split lines, split UTF-8/literals, a body containing IMAP-like text, escaped credentials, LIST special-use attributes, SELECT `UIDVALIDITY`, FETCH flags and malformed/oversized literals.

- [ ] **Step 2: Run protocol tests and verify failure**

Run: `deno test supabase/functions/tests/mail_protocol_test.ts`
Expected: FAIL because protocol exports do not exist.

- [ ] **Step 3: Implement the incremental parser and TLS clients**

Use `Deno.connectTls`, tagged commands, strict response limits, timeouts, redacted errors and deterministic cleanup. `ImapClient` exposes `login`, `list`, `select`, `fetchUids`, `storeFlags`, `move`, `append`, `searchHeader` and `logout`; `SmtpClient` exposes authenticated `send` over port 465 only.

- [ ] **Step 4: Write failing MIME tests**

Cover Unicode headers, multipart alternative, inline CID, binary attachment, reply headers, deterministic `Message-ID`, CRLF normalization and header-injection rejection.

- [ ] **Step 5: Implement MIME normalization/composition and run tests**

Run: `deno test supabase/functions/tests/mail_protocol_test.ts supabase/functions/tests/mail_mime_test.ts`
Expected: PASS without network permissions.

- [ ] **Step 6: Typecheck and commit**

Run: `deno check --node-modules-dir=auto supabase/functions/_shared/mail/transport.ts`

```bash
git add supabase/functions/_shared/mail supabase/functions/tests
git commit -m "feat: add tested IMAP SMTP and MIME core"
```

### Task 3: Schema seguro, busca, Storage e Cron

**Files:**
- Create via CLI: `supabase/migrations/<generated>_crm_mailbox.sql`
- Create: `supabase/tests/crm_mailbox.test.sql`

**Interfaces:**
- Produces: tables named in the spec; private bucket `crm-mail-attachments`; RPCs `crm_mail_list_threads`, `crm_mail_get_thread`, `crm_mail_get_status`, `crm_mail_get_credentials`; internal `crm_mailbox_locks`; configuração segura para ativar depois o Cron `crm-mail-sync-every-minute`.
- Consumes: existing `crm_members`, `crm_records`, `auth.uid()` and Vault.

- [ ] **Step 1: Discover the current CLI and generate the migration filename**

Run: `npx supabase@latest --version && npx supabase@latest migration new crm_mailbox`
Expected: a timestamped migration created by the CLI, never a hand-invented name.

- [ ] **Step 2: Write failing SQL assertions**

Assert all tables/constraints/indexes, authenticated-member reads, non-member denial, client write denial, service-only credential RPC, deduplication, search ranking, UIDVALIDITY reset and private bucket policy.

- [ ] **Step 3: Verify tests fail before schema exists**

Run the assertions against an isolated transaction/schema or local Supabase when available.
Expected: FAIL on missing `crm_mailboxes`.

- [ ] **Step 4: Implement the migration**

Create explicit grants/RLS policies, security-invoker read RPCs, narrowly-scoped service RPCs with revoked execution, Realtime publication entries, Storage policies and idempotent extension setup. Keep all secret values out of the file; Cron is activated only after the function is ACTIVE.

- [ ] **Step 5: Apply to the project and seed secrets out of band**

Use Supabase SQL execution for DDL iteration, then apply the final migration. Insert only non-secret mailbox configuration; place the supplied password and generated Cron token in Vault via parameterized/admin execution and persist only the token hash outside Vault.

- [ ] **Step 6: Verify database security and commit**

Run SQL assertions and Supabase security/performance Advisors; fix every new mailbox finding before commit.

```bash
git add supabase/migrations supabase/tests
git commit -m "feat: add secure mailbox persistence"
```

### Task 4: Edge Function de sincronização

**Files:**
- Create: `supabase/functions/_shared/mail/database.ts`
- Create: `supabase/functions/_shared/mail/sync.ts`
- Create: `supabase/functions/mail-sync/index.ts`
- Test: `supabase/functions/tests/mail_sync_test.ts`
- Modify: `.github/workflows/ci-crm-v2.yml`

**Interfaces:**
- Produces: `syncMailbox(deps, mailboxId, options): Promise<SyncResult>` and internal HTTP endpoint `mail-sync`.
- Consumes: Task 2 `ImapClient`/`normalizeMessage`; Task 3 service RPCs/tables; header `x-oryneo-cron` checked by SHA-256 constant-time comparison.

- [ ] **Step 1: Write failing synchronization tests with fake transports**

Cover new mail, batch cursor resume, duplicate Message-ID, flag reconciliation, remote deletion/move, UIDVALIDITY change, overlapping lock, retryable auth/network failure and sanitized telemetry.

- [ ] **Step 2: Run tests and verify failure**

Run: `deno test supabase/functions/tests/mail_sync_test.ts`
Expected: FAIL because `syncMailbox` does not exist.

- [ ] **Step 3: Implement synchronization and handler**

Prioritize Inbox/recent history, cap each invocation below platform limits, upload attachments to the private bucket, link exact participant addresses to active deals and commit cursor only after message/location writes succeed.

- [ ] **Step 4: Run tests/typecheck and update CI**

Run: `deno test supabase/functions/tests/mail_sync_test.ts && deno check --node-modules-dir=auto supabase/functions/mail-sync/index.ts`
Expected: PASS. CI typechecks both new functions and runs Deno tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions .github/workflows/ci-crm-v2.yml
git commit -m "feat: synchronize Hostinger mailbox"
```

### Task 5: Edge Function autenticada para ações e envio

**Files:**
- Create: `supabase/functions/_shared/mail/actions.ts`
- Create: `supabase/functions/mail-api/index.ts`
- Test: `supabase/functions/tests/mail_actions_test.ts`

**Interfaces:**
- Produces: authenticated actions `send`, `save-draft`, `delete-draft`, `set-flags`, `move`, `retry-send`, `attachment-url`, `link-deal`, `unlink-deal`, `sync-now`.
- Consumes: Task 2 transport/MIME, Task 3 tables/RPCs, deterministic outbox idempotency key and Task 4 sync primitive.

- [ ] **Step 1: Write failing action tests**

Cover missing/invalid JWT, authenticated non-member, malformed recipients, header injection, oversized attachment, stale draft revision, IMAP failure rollback, SMTP retry after accepted message, signed URL authorization and action audit.

- [ ] **Step 2: Run tests and verify failure**

Run: `deno test supabase/functions/tests/mail_actions_test.ts`
Expected: FAIL because action handlers do not exist.

- [ ] **Step 3: Implement membership/auth and operations**

Validate all payloads, execute remote operation first where required, update local state only after confirmation, detect existing deterministic `Message-ID` before retrying SMTP and return stable Portuguese error codes/messages without sensitive values.

- [ ] **Step 4: Run tests and typecheck**

Run: `deno test supabase/functions/tests/mail_actions_test.ts && deno check --node-modules-dir=auto supabase/functions/mail-api/index.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions
git commit -m "feat: add authenticated mailbox actions"
```

### Task 6: Cliente de dados, sanitização e componentes da caixa

**Files:**
- Create: `src/mail/api.ts`
- Create: `src/mail/security.ts`
- Create: `src/mail/Mailbox.tsx`
- Create: `src/mail/FolderList.tsx`
- Create: `src/mail/ThreadList.tsx`
- Create: `src/mail/Conversation.tsx`
- Create: `src/mail/Composer.tsx`
- Create: `src/mail/mail.css`
- Test: `src/mail/security.test.ts`
- Test: `src/mail/Mailbox.test.tsx`
- Test: `src/mail/Composer.test.tsx`

**Interfaces:**
- Produces: `<Mailbox deals onOpenDeal />`, paginated `listThreads`, `getThread`, `getStatus`, `invokeMailAction`, Realtime subscription and `sanitizeMailHtml(html, allowRemoteImages)`.
- Consumes: Task 1 types/formatters and existing Supabase client/`DealRow`.

- [ ] **Step 1: Write failing security tests**

Assert script/event/form removal, unsafe URL removal, remote image blocking by default, CID handling and safe link attributes.

- [ ] **Step 2: Implement sanitization and verify tests**

Run: `npm test -- --run src/mail/security.test.ts`
Expected: PASS after DOMPurify policy implementation.

- [ ] **Step 3: Write failing mailbox behavior tests**

Cover folders/counters, pagination, unread/star, selecting a thread, empty/error/loading/offline states, keyboard navigation, linked opportunity and mobile back navigation.

- [ ] **Step 4: Implement data client and three-pane responsive UI**

Use cursor pagination and invalidate queries on Realtime events; never fetch all messages. Keep remote images opt-in per message and request attachment URLs only on click.

- [ ] **Step 5: Write failing composer tests and implement composition**

Cover To/Cc/Bcc parsing, reply/forward subject/headers, attachment limits, autosave debounce/conflict, successful send, idempotent retry and unsaved-close warning.

- [ ] **Step 6: Run frontend tests/build and commit**

Run: `npm test -- --run && npm run build`
Expected: PASS.

```bash
git add src/mail package.json package-lock.json vite.config.ts
git commit -m "feat: build ORYNEO mailbox experience"
```

### Task 7: Integração no CRM, acessibilidade e regressão

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/nav-v21.css`
- Modify: `src/styles.css`
- Create: `src/App.mail.test.tsx`
- Modify: `README.md`
- Modify: `.github/workflows/publicar-crm-pages.yml`

**Interfaces:**
- Consumes: Task 6 `<Mailbox>`; preserves existing Pipeline, Atividades, autenticação, detalhes e deploy Pages.

- [ ] **Step 1: Write failing navigation/regression tests**

Assert menu order Pipeline/E-mail/Atividades, accessible names/current page, opening linked deal, logout persistence, mobile sidebar and no eager mailbox data before selecting E-mail.

- [ ] **Step 2: Integrate the mailbox and styles**

Replace the reserved navigation slot with E-mail, update breadcrumb/search behavior and preserve the existing refresh logic only for pipeline/activities.

- [ ] **Step 3: Run complete local verification**

Run: `npm test -- --run && npm run build -- --base=/Oryneo_CRM/ && deno test supabase/functions/tests && deno check --node-modules-dir=auto supabase/functions/mail-sync/index.ts supabase/functions/mail-api/index.ts`
Expected: all PASS, no TypeScript errors, built assets use `/Oryneo_CRM/`.

- [ ] **Step 4: Commit**

```bash
git add src README.md .github/workflows
git commit -m "feat: integrate email into ORYNEO CRM"
```

### Task 8: Deploy, homologação real e publicação

**Files:**
- Modify if defects found: only files owned by Tasks 2–7
- Update: checklist in this plan as evidence is collected

**Interfaces:**
- Produces: deployed schema, `mail-sync`, `mail-api`, active Cron, synchronized mailbox and live GitHub Pages frontend.

- [ ] **Step 1: Re-run production preflight**

Confirm clean diff, no secret patterns, exact dependency versions, full test/build/typecheck, current project ID and current production branch head.

- [ ] **Step 2: Deploy Edge Functions**

Deploy `mail-sync` with platform JWT verification disabled plus internal secret validation; deploy `mail-api` with JWT verification enabled. Confirm versions become ACTIVE, then create the unique one-minute Cron job using the token already stored in Vault.

- [ ] **Step 3: Exercise Hostinger end to end**

Invoke one controlled sync, confirm folder discovery and authentication, send a uniquely tagged message to the same mailbox, observe it once in Enviados and once in Inbox/thread, then test read/star/archive and restoration. Remove only the tagged homologation artifact if safe.

- [ ] **Step 4: Verify database and operations**

Query counts/cursors/outbox/sync runs, confirm Cron schedule and recent success, inspect sanitized Edge logs, run security/performance Advisors and verify anonymous/non-member denial.

- [ ] **Step 5: Push and publish GitHub Pages**

Push reviewed commits to `main`, wait for CI and `publicar-crm-pages.yml`, confirm the deployed commit and run authenticated browser smoke at `https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/` on desktop and mobile dimensions.

- [ ] **Step 6: Final verification and handoff**

Confirm production shows E-mail, latest sync is healthy, test message/actions converged and Pipeline/Atividades remain operational. Report deployment SHAs/function versions and any bounded limitation without exposing secrets.
