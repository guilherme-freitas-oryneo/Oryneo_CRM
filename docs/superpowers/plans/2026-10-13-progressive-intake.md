# Progressive Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar um formulário progressivo, mobile-first e acessível em `/comecar/`, preservando seleção comercial e atribuição e enviando somente solicitações completas ao CRM.

**Architecture:** A landing terá uma máquina de estados pequena e testável em ESM, uma camada DOM separada e o `lead-intake` como única fronteira pública de escrita. O navegador faz validação de experiência; a Edge Function repete toda validação de confiança, recalcula valores e grava formatos antigo e novo de forma retrocompatível.

**Tech Stack:** HTML/CSS/JavaScript ESM, Node 22 `node:test`, Deno 2, Supabase Edge Functions, PostgreSQL JSONB, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-12-progressive-intake-first-contact-design.md`

## Global Constraints

- Implementar no repositório `/workspace/Oryneo_Landing_Page`; backend e documentação versionada ficam em `/workspace/Oryneo_CRM`.
- Página pública inicial: `https://guilherme-freitas-oryneo.github.io/Oryneo_Landing_Page/comecar/`; não depender de DNS.
- Usar Graphite `#0F1115`, Off White `#F8F7F4`, Indigo `#4F6BFF`, Inter e somente wordmark oficial monocromático reverso.
- Marca d'água com o wordmark oficial, opacidade de 3% a 5%, `aria-hidden="true"`, sem eventos e sem “Y” colorido.
- Não criar lead parcial; `sessionStorage` somente até o sucesso e limpeza somente após confirmação positiva do backend.
- O backend deve aceitar `acquisition_channel` legado e o novo trio `acquisition_channels`, `primary_acquisition_channel`, `primary_goal`.
- Nome, e-mail válido, WhatsApp com DDD e consentimento são obrigatórios na submissão final.
- `lead-intake` permanece como única escrita pública, com origem restrita, honeypot, `request_id`, limite de corpo e preços recalculados no servidor.
- Nenhuma cobrança ocorre no formulário; consulta de CNPJ é opcional na conversa e CNPJ é obrigatório somente para `contract`.

## Review Focus

- URL com plano, ciclo, complementos ou intenção inválidos: descartar só os valores inválidos e nunca alterar preço.
- Seleção “Ainda não temos um canal previsível” combinada com outro canal: rejeitar/normalizar como exclusiva no cliente e no servidor.
- Dois ou mais canais/objetivos sem principal correspondente: impedir avanço e rejeitar o payload.
- Falha/repetição de rede após clique final: preservar dados e reutilizar o mesmo `request_id`, sem duplicar lead.
- Teclado, zoom de 200%, leitor de tela e imagem de fundo ausente: manter ordem, foco, mensagens e contraste utilizáveis.

---

### Task 1: Contrato de entrada autoritativo

**Files:**
- Create: `supabase/functions/_shared/intake/contract.ts`
- Create: `supabase/functions/tests/lead_intake_contract_test.ts`
- Modify: `supabase/functions/lead-intake/index.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `normalizeIntakePayload(body: Record<string, unknown>): NormalizedIntakePayload`; `NormalizedIntakePayload.formSubmission` contém `acquisition_channel`, `acquisition_channels`, `primary_acquisition_channel`, `goals`, `primary_goal`, `team_size`, `intent` e `attribution`.
- Produces: `quoteSelection(input: Record<string, unknown>): Quote | null`, mantendo catálogo e preços somente no servidor.

- [ ] **Step 1: Escrever testes Deno que cobrem payload legado, múltiplos canais, exclusividade, principais pertencentes às listas, limites de 8 canais/12 objetivos, atribuição truncada e parâmetros comerciais adulterados.**

- [ ] **Step 2: Rodar `deno test supabase/functions/tests/lead_intake_contract_test.ts` e confirmar falha por módulo inexistente.**

- [ ] **Step 3: Extrair normalização/validação pura para `contract.ts`; manter mensagens públicas neutras e lançar códigos internos estáveis (`INVALID_CONTACT`, `INVALID_ACQUISITION`, `INVALID_COMMERCIAL`).**

- [ ] **Step 4: Integrar `normalizeIntakePayload` ao `lead-intake`; preservar origem, corpo máximo de 20.000 bytes, honeypot, fingerprint e RPC idempotente.**

- [ ] **Step 5: Rodar `deno check --node-modules-dir=auto supabase/functions/lead-intake/index.ts` e `deno test supabase/functions/tests/lead_intake_contract_test.ts`; esperar sucesso.**

- [ ] **Step 6: Incluir o novo teste no job `edge` de `.github/workflows/ci.yml` e rodar o comando completo do job localmente.**

- [ ] **Step 7: Commitar no CRM: `git commit -m "feat: extend lead intake contract"`.**

### Task 2: Modelo de estado do formulário

**Files:**
- Create: `/workspace/Oryneo_Landing_Page/comecar/intake-model.mjs`
- Create: `/workspace/Oryneo_Landing_Page/tests/intake-model.test.mjs`

**Interfaces:**
- Consumes: enums e limites do contrato da Task 1.
- Produces: `parseEntryParams(url: URL): EntrySelection`; `validateStep(step: StepId, state: IntakeState): ValidationResult`; `nextVisibleStep(current, state)`; `buildIntakePayload(state, attribution, requestId)`.

- [ ] **Step 1: Escrever testes `node:test` para seis etapas, CNPJ condicional, canais exclusivos, principal automático/obrigatório, objetivos, parâmetros permitidos, UTM/referrer e payload final.**

- [ ] **Step 2: Rodar `node --test tests/intake-model.test.mjs`; esperar falha por módulo inexistente.**

- [ ] **Step 3: Implementar as funções puras e tipos por JSDoc; deduplicar arrays mantendo ordem e nunca aceitar preço/total da URL.**

- [ ] **Step 4: Rodar `node --test tests/intake-model.test.mjs`; esperar todos os testes aprovados.**

- [ ] **Step 5: Commitar na landing: `git commit -m "test: define progressive intake model"`.**

### Task 3: Página progressiva, acessibilidade e identidade visual

**Files:**
- Create: `/workspace/Oryneo_Landing_Page/comecar/index.html`
- Create: `/workspace/Oryneo_Landing_Page/comecar/form.css`
- Create: `/workspace/Oryneo_Landing_Page/comecar/form.js`
- Create: `/workspace/Oryneo_Landing_Page/assets/oryneo-wordmark-mono-reverse.png`
- Create: `/workspace/Oryneo_Landing_Page/tests/progressive-form.test.mjs`

**Interfaces:**
- Consumes: funções de `comecar/intake-model.mjs`; `window.OryneoLeadIntake.send(payload, button, feedback)` de `assets/lead-intake.js`.
- Produces: formulário semântico de seis etapas e evento de sucesso final; chave de sessão `oryneo_progressive_intake_v1`.

- [ ] **Step 1: Escrever teste estrutural que exige título focável por etapa, `aria-live`, progresso, navegação, revisão editável, consentimento, privacidade, wordmark monocromático e ausência de `oryneo-y.svg`/`oryneo-symbol.svg`.**

- [ ] **Step 2: Rodar `node --test tests/progressive-form.test.mjs`; esperar falha porque a página ainda não existe.**

- [ ] **Step 3: Criar o shell HTML com metadados, campos nativos, resumo, estado de sucesso e scripts `type="module"`; uma pergunta principal por tela.**

- [ ] **Step 4: Implementar CSS responsivo com largura legível, foco visível, `prefers-reduced-motion`, sem overflow a 320 px/200% e watermark oficial a 4% de opacidade.**

- [ ] **Step 5: Implementar controlador DOM: foco no título, Enter apenas em etapa válida, erros locais + região anunciável, voltar/editar, restauração de sessão e limpeza somente após `{ok:true}`.**

- [ ] **Step 6: Rodar `node --test tests/intake-model.test.mjs tests/progressive-form.test.mjs` e `node --check comecar/form.js`; esperar sucesso.**

- [ ] **Step 7: Servir localmente e executar smoke manual em 390×844, 320 px e teclado; registrar screenshots sem dados reais.**

- [ ] **Step 8: Commitar na landing: `git commit -m "feat: add progressive commercial intake"`.**

### Task 4: Transporte idempotente e falhas recuperáveis

**Files:**
- Modify: `/workspace/Oryneo_Landing_Page/assets/lead-intake.js`
- Create: `/workspace/Oryneo_Landing_Page/tests/lead-intake.test.mjs`
- Modify: `/workspace/Oryneo_Landing_Page/.github/workflows/ci-landing-v2.yml`

**Interfaces:**
- Consumes: payload da Task 2.
- Produces: `sendLead(payload, fetchImpl): Promise<{ok:true}>`; o mesmo `request_id` é mantido em tentativas do mesmo envio.

- [ ] **Step 1: Escrever testes com `fetch` falso para sucesso, 400, 429, 503, timeout e clique repetido; afirmar uma requisição em voo e preservação de estado em qualquer falha.**

- [ ] **Step 2: Rodar `node --test tests/lead-intake.test.mjs`; esperar falha pelo export ausente.**

- [ ] **Step 3: Separar a função de transporte testável sem quebrar `window.OryneoLeadIntake`; manter chave pública no navegador e nunca inserir segredos.**

- [ ] **Step 4: Atualizar CI para `node --test tests/*.test.mjs`, `node --check` dos scripts e verificações da rota/ativos monocromáticos.**

- [ ] **Step 5: Rodar o job local equivalente; esperar sucesso.**

- [ ] **Step 6: Commitar na landing: `git commit -m "fix: make lead submission safely retryable"`.**

### Task 5: CTAs, privacidade e indexação

**Files:**
- Modify: `/workspace/Oryneo_Landing_Page/index.html`
- Modify: `/workspace/Oryneo_Landing_Page/assets/commercial.js`
- Modify: `/workspace/Oryneo_Landing_Page/privacidade.html`
- Modify: `/workspace/Oryneo_Landing_Page/sitemap.xml`
- Modify: `/workspace/Oryneo_Landing_Page/README.md`
- Create: `/workspace/Oryneo_Landing_Page/tests/commercial-links.test.mjs`

**Interfaces:**
- Produces: `buildCommercialUrl(choice, attribution): string` apontando para `./comecar/` e preservando apenas `plan`, `cycle`, `services`, `intent` e UTMs permitidos.

- [ ] **Step 1: Escrever testes para todos os CTAs comerciais (`data-plan-action`, `data-open-talk`, hero e “Quero organizar minha operação”): Start/Growth/Scale, conversa/contratação, mensal/anual, zero/um/dois complementos e UTMs, sem parâmetros de preço.**

- [ ] **Step 2: Rodar `node --test tests/commercial-links.test.mjs`; esperar falha pela rota antiga.**

- [ ] **Step 3: Fazer todos os CTAs comerciais navegarem para `/comecar/` via URL relativa compatível com GitHub Pages; manter o formulário antigo inacessível pelos CTAs, mas sem removê-lo neste commit.**

- [ ] **Step 4: Atualizar privacidade com backend, categorias, finalidade, CNPJ opcional, atribuição, sessão local e direitos; não declarar analytics inexistente.**

- [ ] **Step 5: Adicionar `/comecar/` ao sitemap e documentar o fluxo no README.**

- [ ] **Step 6: Rodar todos os testes/CI da landing e validar HTML sem links quebrados.**

- [ ] **Step 7: Commitar na landing: `git commit -m "feat: route commercial CTAs to intake"`.**
