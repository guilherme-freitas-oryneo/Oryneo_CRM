# Production Rollout and Homologation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implantar banco, Edge Functions, CRM e formulário na ordem segura e comprovar submissão, envio, Enviados, resposta, sincronização e vínculo reais antes de declarar conclusão.

**Architecture:** O rollout é progressivo e retrocompatível: banco primeiro, contratos Edge em seguida, consumidores internos depois e tráfego público por último. Cada etapa possui uma verificação objetiva e um ponto de rollback por versão/commit; testes reais usam um destinatário de homologação autorizado e dados claramente identificados.

**Tech Stack:** Supabase migrations/Edge Functions/advisors/logs, GitHub Actions/Pages, Playwright Chromium/WebKit, SMTP/IMAP Hostinger, Git.

**Spec:** `docs/superpowers/specs/2026-10-12-progressive-intake-first-contact-design.md`

## Global Constraints

- Não alterar DNS da Hostinger nem depender de `oryneo.com.br` nesta entrega.
- Não gravar senha, token, corpo sensível ou chave de serviço em commits, artefatos, screenshots ou logs.
- Deploy na ordem: banco → `lead-intake` → `mail-api` → CRM → homologação de e-mail → `/comecar/` → CTAs → smoke público.
- Não afirmar envio/recebimento/sincronização sem evidência real de SMTP, pasta Enviados, IMAP e vínculo com o lead.
- Não enviar teste para terceiro sem destinatário de homologação autorizado; se esse endereço não estiver disponível, pausar somente a etapa real.
- Cada mudança deve ter rollback explícito por versão da Edge Function ou commit anterior, sem apagar dados de leads.

## Review Focus

- Backend novo com frontend antigo e frontend novo com backend antigo durante propagação: ambos devem continuar operando ou falhar fechados sem perda de dados.
- GitHub Pages com base path: todos os assets e links devem resolver sob `/Oryneo_CRM/` e `/Oryneo_Landing_Page/`.
- Cache/CORS após deploy: nova página e Edge devem responder com versão atual e origem exata, não apenas em aba autenticada.
- Homologação de retry: repetir a mesma chave após falha simulada/recuperada não pode criar segundo e-mail/evento.
- Resposta real: mensagem recebida precisa sincronizar e vincular ao mesmo lead, mesmo com assunto `Re:` e referências MIME.

---

### Task 1: Gate integral pré-deploy

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `/workspace/Oryneo_Landing_Page/.github/workflows/ci-landing-v2.yml`
- Create: `docs/releases/2026-10-13-progressive-intake-first-contact.md`

**Interfaces:**
- Produces: matriz de versões/commits, comandos, resultados e alvos de rollback preenchida durante o rollout.

- [ ] **Step 1: Atualizar CIs para todos os novos testes, typechecks e builds, sem instalar dependências não fixadas no lockfile.**

- [ ] **Step 2: Rodar no CRM `npm test -- --run`, `npm run build`, todos os `deno test` e `deno check`; exigir zero falhas.**

- [ ] **Step 3: Rodar na landing `node --test tests/*.test.mjs`, checks de sintaxe e o job local equivalente; exigir zero falhas.**

- [ ] **Step 4: Rodar testes SQL em banco local/efêmero e advisors; corrigir qualquer alerta novo de segurança ou performance.**

- [ ] **Step 5: Registrar SHAs aprovados, versão atual de cada Edge Function e rollback no release doc.**

- [ ] **Step 6: Commitar documentação/CI: `git commit -m "ci: gate progressive intake release"`.**

### Task 2: Banco e Edge Functions retrocompatíveis

**Files:**
- Use: migration e Edge Functions dos dois planos de implementação.
- Update: `docs/releases/2026-10-13-progressive-intake-first-contact.md`

**Interfaces:**
- Produces: schema aplicado, `lead-intake` aceitando contratos antigo/novo e `mail-api` com ação autenticada.

- [ ] **Step 1: Capturar contagem por etapa, IDs, versões das funções e advisors antes da mudança.**

- [ ] **Step 2: Aplicar migration versionada; consultar nomes/IDs, privilégios da RPC e amostra de registros para provar preservação.**

- [ ] **Step 3: Implantar `lead-intake`; testar CORS e duas requisições controladas (legada e nova) com `request_id` distinto, sem publicar a rota nova.**

- [ ] **Step 4: Implantar `mail-api`; testar que requisição sem sessão retorna 401 e membro autenticado consegue apenas ações permitidas.**

- [ ] **Step 5: Consultar logs redigidos e advisors; exigir ausência de segredo/PII desnecessária e alertas críticos novos.**

- [ ] **Step 6: Registrar versões resultantes e resultados no release doc.**

### Task 3: Publicação e smoke autenticado do CRM

**Files:**
- Modify: `.github/workflows/live-smoke.yml`
- Update: `docs/releases/2026-10-13-progressive-intake-first-contact.md`

**Interfaces:**
- Produces: CRM público com pipeline renomeado e ações de contato; smoke público não envia e-mail.

- [ ] **Step 1: Fazer merge/push do SHA aprovado do CRM e aguardar workflow de Pages verde.**

- [ ] **Step 2: Verificar HTML/assets públicos e login em Chromium/WebKit mobile, sem erros de console/HTTP.**

- [ ] **Step 3: Em sessão autenticada, confirmar nomes das sete etapas, oportunidades preservadas, prévia correta, botão condicionado e URL `wa.me`; não confirmar envio ainda.**

- [ ] **Step 4: Registrar URL, SHA publicado, screenshots sem PII e resultado no release doc; se falhar, reverter ao SHA anterior e interromper rollout.**

### Task 4: Homologação real de e-mail e sincronização

**Files:**
- Update: `docs/releases/2026-10-13-progressive-intake-first-contact.md`

**Interfaces:**
- Consumes: destinatário de homologação autorizado, lead de teste identificável e caixa `contato@oryneo.com.br`.
- Produces: evidências com timestamps/IDs técnicos redigidos de SMTP, Enviados, IMAP, resposta e vínculo.

- [ ] **Step 1: Criar/usar um lead de conversa de homologação com múltiplos canais e e-mail autorizado; anotar etapa e próxima ação antes do envio.**

- [ ] **Step 2: Revisar HTML e texto no diálogo e confirmar uma vez; verificar destinatário recebeu exatamente uma mensagem e card permaneceu em Diagnóstico pendente.**

- [ ] **Step 3: Confirmar mensagem na pasta Enviados e sincronizada no CRM, com status/data/evento e próxima ação de um dia útil.**

- [ ] **Step 4: Repetir a chamada com a mesma chave de idempotência e provar ausência de segundo recebimento/evento.**

- [ ] **Step 5: Responder pela caixa de homologação, sincronizar e confirmar vínculo da entrada ao mesmo lead/thread.**

- [ ] **Step 6: Repetir fluxo de envio com um lead `contract`, sem necessidade de segunda resposta, para validar o segundo modelo.**

- [ ] **Step 7: Registrar resultados redigidos; se SMTP/IMAP/vínculo falhar, interromper publicação do formulário e restaurar a versão anterior do `mail-api`.**

### Task 5: Publicação do formulário sem redirecionar CTAs

**Files:**
- Modify: `/workspace/Oryneo_Landing_Page/.github/workflows/ci-landing-v2.yml`
- Update: `docs/releases/2026-10-13-progressive-intake-first-contact.md`

**Interfaces:**
- Produces: `/comecar/` público e testável, ainda sem tráfego dos CTAs principais.

- [ ] **Step 1: Publicar commit que contém `/comecar/`, transporte e privacidade, mas mantém CTAs no comportamento anterior.**

- [ ] **Step 2: Em Chromium/WebKit mobile, testar carregamento, watermark 4%, ausência de logo colorido, teclado, restauração de sessão, 200% zoom e todos os parâmetros comerciais.**

- [ ] **Step 3: Fazer uma submissão real `conversation` e uma `contract`; confirmar payload, preço recalculado, canais/principais/UTM e criação única no CRM.**

- [ ] **Step 4: Confirmar que falha induzida preserva o formulário e que retry com o mesmo `request_id` não duplica lead.**

- [ ] **Step 5: Registrar SHA/resultado; reverter o commit da página se qualquer teste falhar.**

### Task 6: Ativação dos CTAs e fechamento

**Files:**
- Modify: `/workspace/Oryneo_Landing_Page/.github/workflows/ci-landing-v2.yml`
- Modify: `.github/workflows/live-smoke.yml`
- Update: `docs/releases/2026-10-13-progressive-intake-first-contact.md`

**Interfaces:**
- Produces: tráfego comercial apontando para `/comecar/` e relatório final verificável.

- [ ] **Step 1: Publicar o commit de CTAs após Tasks 1–5 aprovadas.**

- [ ] **Step 2: Testar publicamente cada família de CTA e afirmar preservação de plano/ciclo/complementos/intenção/UTMs, sem preço na URL.**

- [ ] **Step 3: Rodar smoke conjunto em Chromium e WebKit: landing → `/comecar/` → submissão controlada → CRM; o smoke automatizado não envia e-mail real.**

- [ ] **Step 4: Confirmar GitHub Actions verdes, versões Edge ativas, advisors sem alertas críticos novos e logs sem erro recorrente.**

- [ ] **Step 5: Preencher release doc com URLs, SHAs, versões, resultados e limitações fora de escopo; só então marcar a entrega concluída.**

- [ ] **Step 6: Commitar evidências não sensíveis: `git commit -m "docs: record first contact homologation"`.**
