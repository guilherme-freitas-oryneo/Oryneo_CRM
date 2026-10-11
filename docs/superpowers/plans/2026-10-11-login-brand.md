# ORYNEO Login and Brand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir os assets legados e tornar a entrada do CRM clara, responsiva e acessível sem alterar a autenticação.

**Architecture:** Reutilizar os componentes React atuais e concentrar a nova composição em CSS do login. Usar os arquivos oficiais do Brand Kit, conferidos por hash. Testar com navegador e rede Supabase simulada.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7.1, Supabase JS 2.90.1, Playwright 1.56.1 no fluxo de QA.

**Spec:** `docs/superpowers/specs/2026-10-11-login-brand-design.md`

## Global Constraints

- Não redesenhar Y nem wordmark; usar masters oficiais do Drive.
- Preservar `signInWithPassword` e fluxo de erros neutros.
- Não alterar banco, RLS, LP ou comportamento comercial neste lote.
- Não usar dados reais nos testes e capturas.

## Review Focus

- Viewport 320 px e zoom 200%: nenhum overflow horizontal; campos e CTA alcançáveis.
- Senha visível: botão acessível e tipo do input alternado.
- Erro simulado: anúncio por `role=alert`, sem revelar se o usuário existe.
- Modo ocupado: submit desativado, sem clique duplo.
- Assets: hashes oficiais e fundo transparente do Y.

---

### Task 1: Teste de regressão de acesso e marca

**Files:**
- Create: `.github/scripts/qa-login-brand.mjs`
- Modify: `.github/workflows/qa-crm-v21.yml`

**Interfaces:** Usa `http://127.0.0.1:4173/Oryneo_CRM/`, sem sessão, e intercepta chamadas ao Supabase. Produz capturas em `qa-results/`.

- [x] Escrever teste de browser para assets aprovados, layout em 1440 e 320 px, fluxo de foco e estados de formulário.
- [x] Rodar contra o build base e confirmar falha esperada no asset/layout (hash anterior divergente; seletor do layout antigo ausente).
- [x] Vincular teste ao workflow existente, sem exigir credenciais reais.

### Task 2: Assets oficiais e composição visual

**Files:**
- Modify: `public/oryneo-y.svg`, `src/App.tsx`, `src/components.tsx`, `src/styles.css`, `src/nav-v21.css`
- Create: `public/oryneo-wordmark-master.png`

**Interfaces:** `oryneo-y.svg` e `oryneo-wordmark-master.png` servidos pela base Vite. O login continua exportado como `Login()`.

- [x] Buscar masters no Drive e conferir SHA-256 com `manifest_oficial.sha256.json`.
- [x] Trocar o símbolo compacto e o login para os assets oficiais, sem editar sua geometria.
- [x] Aplicar a composição clara e adaptar mobile/foco/erro/ocupado.
- [x] Rodar QA de login em Chromium desktop, mobile e viewport de zoom.

### Task 3: Verificação e entrega

**Files:**
- Modify: documentação do plano para marcar resultado.

- [x] Rodar `npm run build -- --base=/Oryneo_CRM/`.
- [ ] Rodar QA de login e o QA funcional v2.1 em Chromium e WebKit (Chromium passou localmente; WebKit aguarda CI por bibliotecas ausentes no executor).
- [x] Revisar capturas, diff e hashes; registrar limitações.
- [ ] Commitar em branch isolada e abrir PR com evidências.
