# ORYNEO CRM Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um CRM ORYNEO funcional com autenticação Supabase, pipeline Kanban persistente, configuração segura de etapas e deploy verificado no GitHub Pages.

**Architecture:** Uma SPA React/Vite consome exclusivamente o cliente público Supabase e organiza a aplicação por autenticação, domínio do pipeline e componentes visuais. O banco garante isolamento por organização via RLS e concentra mutações multi-registro em RPCs transacionais; a UI usa TanStack Query para sincronização e `@dnd-kit` para movimentos acessíveis.

**Tech Stack:** React 19, TypeScript, Vite, React Router, TanStack Query, Supabase JS, React Hook Form, Zod, dnd-kit, Lucide React, Vitest, Testing Library, CSS.

**Spec:** `docs/superpowers/specs/2026-10-09-pipeline-oportunidades-design.md`

## Global Constraints

- Figma `xIRj2eI4Kt14xgEAjlKEmp`: frames `3:10` e `3:382` são a direção visual; corrigir enquadramento e responsividade quando necessário.
- Cores: `#0F1115`, `#4F6BFF`, `#F8F7F4`, `#6B7280`, `#A1A1AA`, `#E5E7EB`; fonte Inter.
- Reutilizar o wordmark oficial da landing V32; não usar `CANDIDATE_*` do Brand Kit v0.9.
- Sem cadastro público; autenticação por e-mail/senha e recuperação via Supabase.
- Nunca versionar `.env`, senhas, tokens, service-role key ou valores de secrets.
- Toda entidade de negócio deve ser isolada por organização com RLS.
- Implementar hover, foco, disabled, loading, erro, vazio, redução de movimento e responsividade junto ao componente que os exige.
- Não inventar métricas, integrações ou recursos ainda inexistentes.
- TDD obrigatório para comportamento novo: teste falhando, implementação mínima, suíte verde.

## Review Focus

- Sessão ausente, expirada ou sem associação ativa redireciona para login sem revelar dados.
- Usuário de uma organização nunca lê ou altera dados de outra, mesmo enviando UUID manualmente.
- Movimento otimista que falha volta o card à posição original e mantém as métricas corretas.
- Excluir etapa com oportunidades exige destino diferente e não perde atividade nem oportunidade.
- Teclado, telas estreitas e `prefers-reduced-motion` preservam acesso a todas as ações.

---

### Task 1: Fundação React, segurança de ambiente e integração contínua

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/providers.tsx`
- Create: `src/test/setup.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy-pages.yml`
- Modify: `README.md`

**Interfaces:**
- Produces: `AppProviders({ children }: PropsWithChildren)`, scripts `dev`, `test`, `test:run`, `lint`, `build`, `typecheck`.

- [ ] **Step 1: Scaffold Vite React TypeScript and install pinned runtime/test dependencies**
- [ ] **Step 2: Configure Vitest with jsdom and Testing Library**
- [ ] **Step 3: Add environment contract containing only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` names**
- [ ] **Step 4: Add CI workflow that runs install, typecheck, tests and build**
- [ ] **Step 5: Add Pages workflow that reads both values from GitHub Actions Secrets**
- [ ] **Step 6: Run `npm run typecheck && npm run test:run && npm run build`; expect exit 0**
- [ ] **Step 7: Commit `chore: scaffold secure React application`**

### Task 2: Modelo Supabase, bootstrap e RLS

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202610090001_pipeline_foundation.sql`
- Create: `supabase/tests/pipeline_rls.test.sql`
- Create: `src/lib/supabase/database.types.ts`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/client.test.ts`

**Interfaces:**
- Produces: `supabase` browser client; tables `profiles`, `organizations`, `organization_members`, `pipelines`, `pipeline_stages`, `opportunities`, `opportunity_activities`; RPCs `move_opportunity`, `reorder_pipeline_stages`, `delete_pipeline_stage`.

- [ ] **Step 1: Write failing client configuration tests for missing URL/key and valid initialization**
- [ ] **Step 2: Run `npm run test:run -- src/lib/supabase/client.test.ts`; expect missing-module failure**
- [ ] **Step 3: Implement the typed Supabase client and environment validation**
- [ ] **Step 4: Run the client tests; expect pass**
- [ ] **Step 5: Write migration with enums/checks, bootstrap trigger, indexes, update timestamps and five default stages**
- [ ] **Step 6: Add RLS policies using active organization membership and security-definer helper functions with fixed `search_path`**
- [ ] **Step 7: Add transactional RPCs that validate organization membership server-side**
- [ ] **Step 8: Add pgTAP coverage for cross-organization denial, bootstrap, move history and safe stage deletion**
- [ ] **Step 9: Run `supabase db reset && supabase test db` when the local runtime is available; otherwise validate remotely before deploy and report the exact limitation**
- [ ] **Step 10: Commit `feat: add secure Supabase pipeline schema`**

### Task 3: Login ORYNEO e ciclo de sessão

**Files:**
- Create: `src/features/auth/auth.api.ts`
- Create: `src/features/auth/auth.schema.ts`
- Create: `src/features/auth/AuthProvider.tsx`
- Create: `src/features/auth/ProtectedRoute.tsx`
- Create: `src/features/auth/LoginPage.tsx`
- Create: `src/features/auth/ResetPasswordPage.tsx`
- Create: `src/features/auth/auth.css`
- Create: `src/features/auth/LoginPage.test.tsx`
- Create: `src/features/auth/ProtectedRoute.test.tsx`
- Create: `public/oryneo-wordmark.svg`

**Interfaces:**
- Produces: `useAuth(): AuthContextValue`, `signIn(email, password)`, `signOut()`, `requestPasswordReset(email)`, rotas `/login` e `/redefinir-senha`.

- [ ] **Step 1: Write failing tests for validation, loading, invalid credentials, recovery confirmation and protected redirect**
- [ ] **Step 2: Run both auth test files; expect failures because components are absent**
- [ ] **Step 3: Implement API wrappers and provider driven by Supabase auth state**
- [ ] **Step 4: Implement the professional branded login and reset screens from the approved benchmark**
- [ ] **Step 5: Add hover, focus-visible, disabled, error, mobile layout and reduced-motion styles**
- [ ] **Step 6: Run auth tests and full suite; expect pass**
- [ ] **Step 7: Verify login at 320, 768 and 1440 CSS-pixel widths**
- [ ] **Step 8: Commit `feat: add branded Supabase authentication`**

### Task 4: Domínio do pipeline, consultas e métricas

**Files:**
- Create: `src/features/pipeline/pipeline.types.ts`
- Create: `src/features/pipeline/pipeline.metrics.ts`
- Create: `src/features/pipeline/pipeline.metrics.test.ts`
- Create: `src/features/pipeline/pipeline.filters.ts`
- Create: `src/features/pipeline/pipeline.filters.test.ts`
- Create: `src/features/pipeline/pipeline.api.ts`
- Create: `src/features/pipeline/usePipeline.ts`

**Interfaces:**
- Produces: `calculatePipelineMetrics(stages, opportunities): PipelineMetrics`, `filterOpportunities(items, filters)`, `usePipeline(): UseQueryResult<PipelineSnapshot>`, mutation functions for CRUD/move/stages.

- [ ] **Step 1: Write failing metric tests for totals, weighted forecast, closed exclusion and missing next step**
- [ ] **Step 2: Write failing filter tests for normalized search, source, owner, temperature and next action**
- [ ] **Step 3: Run both tests; expect missing-module failures**
- [ ] **Step 4: Implement pure metric and filter functions with integer cents**
- [ ] **Step 5: Run domain tests; expect pass**
- [ ] **Step 6: Implement typed Supabase queries and mutation functions**
- [ ] **Step 7: Implement TanStack Query hook and stable query keys**
- [ ] **Step 8: Run full suite and typecheck; expect pass**
- [ ] **Step 9: Commit `feat: add pipeline data domain`**

### Task 5: Shell responsivo e Kanban fiel ao Figma

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Create: `src/features/pipeline/PipelinePage.tsx`
- Create: `src/features/pipeline/PipelineSidebar.tsx`
- Create: `src/features/pipeline/PipelineHeader.tsx`
- Create: `src/features/pipeline/PipelineMetrics.tsx`
- Create: `src/features/pipeline/PipelineToolbar.tsx`
- Create: `src/features/pipeline/KanbanBoard.tsx`
- Create: `src/features/pipeline/PipelineColumn.tsx`
- Create: `src/features/pipeline/OpportunityCard.tsx`
- Create: `src/features/pipeline/pipeline.css`
- Create: `src/features/pipeline/PipelinePage.test.tsx`

**Interfaces:**
- Consumes: `usePipeline`, `calculatePipelineMetrics`, `filterOpportunities`.
- Produces: rota `/pipeline`; callbacks `onCreateOpportunity`, `onEditOpportunity`, `onConfigureStages`, `onMoveOpportunity`.

- [ ] **Step 1: Write failing rendering tests for the five stages, real metrics, search/filter and empty/error states**
- [ ] **Step 2: Run page test; expect missing-component failure**
- [ ] **Step 3: Implement shell, sidebar, topbar, metrics, toolbar, columns and cards**
- [ ] **Step 4: Implement tokens, hover/focus states, desktop proportions, horizontal Kanban overflow and compact mobile shell**
- [ ] **Step 5: Replace prototype glyphs with Lucide icons and preserve accessible names**
- [ ] **Step 6: Run page tests, full suite, typecheck and build; expect pass**
- [ ] **Step 7: Compare at 1600×940 with Figma frame `3:10`; fix in-scope visual mismatches**
- [ ] **Step 8: Verify 320, 768, 1024 and 1440 widths without clipped controls**
- [ ] **Step 9: Commit `feat: build responsive opportunity pipeline`**

### Task 6: CRUD de oportunidades e resultados

**Files:**
- Create: `src/features/pipeline/OpportunityDrawer.tsx`
- Create: `src/features/pipeline/opportunity.schema.ts`
- Create: `src/features/pipeline/OpportunityDrawer.test.tsx`
- Modify: `src/features/pipeline/PipelinePage.tsx`
- Modify: `src/features/pipeline/pipeline.css`

**Interfaces:**
- Produces: `OpportunityDrawerProps`, payload `OpportunityInput`, actions criar, editar, ganhar, perder e reabrir.

- [ ] **Step 1: Write failing tests for required fields, non-negative value, create, edit, close and restore-focus behavior**
- [ ] **Step 2: Run drawer test; expect missing-component failure**
- [ ] **Step 3: Implement Zod schema and form with cents-safe currency parsing**
- [ ] **Step 4: Implement accessible drawer with focus trap, Escape and responsive full-screen mobile state**
- [ ] **Step 5: Wire create/edit/outcome mutations and actionable errors**
- [ ] **Step 6: Run drawer tests and full suite; expect pass**
- [ ] **Step 7: Commit `feat: manage pipeline opportunities`**

### Task 7: Drag-and-drop e configuração segura de etapas

**Files:**
- Create: `src/features/pipeline/StageConfigDrawer.tsx`
- Create: `src/features/pipeline/StageConfigDrawer.test.tsx`
- Create: `src/features/pipeline/pipeline.optimistic.ts`
- Create: `src/features/pipeline/pipeline.optimistic.test.ts`
- Modify: `src/features/pipeline/KanbanBoard.tsx`
- Modify: `src/features/pipeline/OpportunityCard.tsx`
- Modify: `src/features/pipeline/PipelinePage.tsx`
- Modify: `src/features/pipeline/pipeline.css`

**Interfaces:**
- Produces: `moveOpportunityOptimistically(snapshot, command)`, `rollbackPipeline(previous)`, `StageDraft[]`, menu acessível `Mover para...`.

- [ ] **Step 1: Write failing tests for optimistic move, counts/values, rollback and same-column ordering**
- [ ] **Step 2: Write failing drawer tests for create/edit/reorder and required destination on deletion**
- [ ] **Step 3: Run new tests; expect missing-module failures**
- [ ] **Step 4: Implement pure optimistic transforms and rollback state**
- [ ] **Step 5: Add dnd-kit pointer/keyboard sensors and persist through the move RPC**
- [ ] **Step 6: Add `Mover para...` menu as keyboard/mobile alternative**
- [ ] **Step 7: Implement stage drawer matching Figma frame `3:382` with safe delete flow**
- [ ] **Step 8: Run focused tests and full suite; expect pass**
- [ ] **Step 9: Compare desktop drawer with Figma and verify mobile full-screen layout**
- [ ] **Step 10: Commit `feat: add pipeline drag drop and stage settings`**

### Task 8: Configuração Supabase, QA visual, segurança e deploy

**Files:**
- Modify: `README.md`
- Modify: `.github/workflows/deploy-pages.yml`
- Create: `docs/deployment.md`
- Create: `docs/benchmark-login.md`

**Interfaces:**
- Consumes: GitHub remote `origin`, Supabase project URL/public anon key supplied securely.
- Produces: banco migrado, secrets de Actions, commit remoto e GitHub Pages validado.

- [ ] **Step 1: Document benchmark decisions with official HubSpot, Pipedrive and RD Station sources**
- [ ] **Step 2: Verify working tree and inspect every diff; no unrelated files**
- [ ] **Step 3: Run secret scan for private keys, JWT/service-role patterns, passwords and tracked `.env` files; expect no findings**
- [ ] **Step 4: Run `npm ci && npm run typecheck && npm run test:run && npm run build`; expect exit 0 and zero test failures**
- [ ] **Step 5: Apply Supabase migration to the intended project without printing credentials**
- [ ] **Step 6: Create or verify the first authorized user and validate login, reset, RLS, CRUD, drag/drop and stage deletion against Supabase**
- [ ] **Step 7: Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as GitHub Actions Secrets**
- [ ] **Step 8: Push commits to `origin/main` only after fresh verification**
- [ ] **Step 9: Confirm CI and Pages workflows are green and inspect the deployed page**
- [ ] **Step 10: Re-run the production smoke test at desktop and mobile widths**
- [ ] **Step 11: Commit any documentation-only corrections and push after repeating verification**
