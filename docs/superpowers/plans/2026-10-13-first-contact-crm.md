# CRM First Contact and SLA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir revisar e enviar o primeiro e-mail personalizado pelo CRM, registrar o contato com idempotência e aplicar pipeline/SLA sem mover o lead automaticamente.

**Architecture:** Um renderizador puro e compartilhado gera exatamente a mesma mensagem na prévia e na Edge Function. A ação autenticada `send-first-contact` resolve o lead e a caixa no servidor, envia pelo transporte existente e só depois da aceitação SMTP registra status, evento e próxima ação por RPC restrita ao `service_role`.

**Tech Stack:** React 19, TypeScript 5.9, Vitest/Testing Library, Deno 2, Supabase Edge Functions, PostgreSQL 17, SMTP/IMAP existentes.

**Spec:** `docs/superpowers/specs/2026-10-12-progressive-intake-first-contact-design.md`

## Global Constraints

- Dois modelos mestres apenas: `conversation` e `contract`, sempre multipart HTML/texto.
- Nenhum “Y” colorido, PDF, banner ou imagem de conteúdo; apenas wordmark monocromático e mensagem completa sem imagens.
- O `src` da imagem no e-mail real deve ser HTTPS absoluto e público; a prévia local pode injetar sua própria URL.
- Canais múltiplos: 1 específico; 2–3 com principal + complementares; 4+ como “diferentes frentes”; sem previsibilidade com copy própria.
- Botão só em `Diagnóstico pendente`; prévia e confirmação obrigatórias; envio exige sessão autenticada e membro do CRM.
- O destinatário e conteúdo são derivados do lead no servidor; navegador não pode escolher HTML arbitrário para esta ação.
- Aceitação SMTP não muda etapa; atualiza próxima ação para “Acompanhar resposta do diagnóstico” em um dia útil.
- Duplo clique/retry com mesma chave não pode produzir segundo e-mail; reenvio nos detalhes usa nova confirmação e nova chave.
- Senha da caixa e `service_role` nunca chegam ao navegador, ao log ou ao histórico do lead.

## Review Focus

- Lead sem e-mail válido, fora da primeira etapa ou removido entre prévia e envio: bloquear no servidor sem marcar envio.
- SMTP aceito seguido de falha no append/RPC: retry com a mesma chave repara Enviados/registro sem retransmitir ao destinatário.
- Dados do lead com HTML/quebras de cabeçalho: escapar corpo e impedir header injection.
- Payload legado com um canal e payload novo com principais ausentes/inconsistentes: renderizar copy verdadeira e previsível, nunca inventar contexto.
- Horários em sexta, fim de semana, 15:59, 16:00 e mudança de offset de São Paulo: produzir prazo da regra, sem depender do fuso do navegador.

---

### Task 1: Renderizador canônico para múltiplos canais

**Files:**
- Create: `supabase/functions/_shared/mail/first-contact-template.ts`
- Modify: `src/mail/firstContactTemplates.ts`
- Modify: `src/mail/firstContactTemplates.test.ts`
- Modify: `src/emailPreview/fixtures.ts`
- Create: `supabase/functions/tests/first_contact_template_test.ts`

**Interfaces:**
- Produces: `FirstContactInput` com `intent`, `firstName`, `company`, `plan`, `cycle`, `addOns`, `goals`, `primaryGoal`, `acquisitionChannels`, `primaryAcquisitionChannel`, `logoUrl?`.
- Produces: `renderFirstContactEmail(input): {subject; preheader; text; html}`; `src/mail/firstContactTemplates.ts` apenas reexporta a implementação canônica.

- [ ] **Step 1: Ampliar testes Vitest para 48 combinações (2 intenções × grupos de canal × complementos/ciclo), escaping, equivalência semântica HTML/texto, fallback legado e ausência de fontes/logos coloridos.**

- [ ] **Step 2: Criar teste Deno mínimo do mesmo módulo para provar compatibilidade do bundle da Edge Function.**

- [ ] **Step 3: Rodar `npm test -- --run src/mail/firstContactTemplates.test.ts` e `deno test supabase/functions/tests/first_contact_template_test.ts`; esperar falhas das novas propriedades.**

- [ ] **Step 4: Mover o renderizador puro para `_shared`, implementar regras 1/2–3/4+/imprevisível e manter o texto com voz humana, sem superlativos ou copy genérica.**

- [ ] **Step 5: Atualizar fixtures e galeria; rodar ambos os testes e `npm run build`; esperar sucesso.**

- [ ] **Step 6: Commitar: `git commit -m "feat: personalize first contact by acquisition mix"`.**

### Task 2: Pipeline, SLA e registro idempotente

**Files:**
- Create: `supabase/migrations/<generated>_crm_first_contact_sla.sql`
- Create: `supabase/tests/crm_first_contact.test.sql`
- Modify: `src/data.ts`

**Interfaces:**
- Produces: `public.crm_business_due(p_from timestamptz, p_rule text): timestamptz`, com `p_rule` em `initial_two_hours | next_weekday`, sem feriados e preservando relógio local de São Paulo no próximo dia útil.
- Produces: `public.crm_record_first_contact(p_deal_id uuid, p_idempotency_key uuid, p_internet_message_id text, p_actor uuid): jsonb`, executável somente por `service_role`; o horário de registro é gerado no banco e devolvido pela RPC.
- Produces: `Deal.first_contact?: {sent_at: string; internet_message_id: string; idempotency_key: string}` e campos novos de `form_submission`.

- [ ] **Step 1: Criar a migration com `supabase migration new crm_first_contact_sla`; não inventar timestamp manual.**

- [ ] **Step 2: Escrever teste SQL transacional para nomes/IDs preservados, prazos em todos os limites do Review Focus (`08:00:00` e `16:00:00` inclusivos; depois de `16:00:00`, 10h no próximo dia útil), entrada em Diagnóstico pendente e RPC idempotente/restrita.**

- [ ] **Step 3: Rodar o teste contra banco local/efêmero; esperar falha por funções ausentes.**

- [ ] **Step 4: Renomear as sete etapas por posição sem trocar IDs; atualizar `crm_intake` para próxima ação “Realizar primeiro contato” com prazo calculado.**

- [ ] **Step 5: Ampliar de forma versionada a restrição de `crm_events.event_type` para `email_sent` e implementar `crm_record_first_contact`: bloquear lead ausente, persistir `data.first_contact`, incrementar revisão uma vez, inserir evento e criar próxima ação em um dia útil, sem tocar `stage_id`.**

- [ ] **Step 6: Revogar execução das duas funções de `PUBLIC/anon/authenticated`, conceder somente `service_role`, fixar `search_path` e manter RLS das tabelas existentes.**

- [ ] **Step 7: Atualizar tipos em `src/data.ts`; rodar teste SQL, advisors e `npm run build`; esperar sucesso/nenhum alerta novo crítico.**

- [ ] **Step 8: Commitar: `git commit -m "feat: add first contact SLA and audit record"`.**

### Task 3: Ação autenticada de envio

**Files:**
- Create: `supabase/functions/_shared/mail/first-contact.ts`
- Create: `supabase/functions/tests/first_contact_action_test.ts`
- Modify: `supabase/functions/mail-api/handler.ts`
- Modify: `supabase/functions/mail-api/index.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `renderFirstContactEmail`, `sendMail`, `private.crm_record_first_contact`.
- Produces: ação `send-first-contact` com payload `{dealId: string; mailboxId: string; idempotencyKey: string; resend?: boolean}` e retorno `{internetMessageId; alreadyAccepted; sentAt}`.

- [ ] **Step 1: Escrever testes com dependências falsas para não-membro, etapa incorreta, e-mail inválido, destinatário derivado do lead, sucesso SMTP, falha SMTP, retry após aceitação, registro posterior e reenvio explícito.**

- [ ] **Step 2: Rodar os testes; esperar `INVALID_ACTION`/módulo ausente.**

- [ ] **Step 3: Implementar orquestrador: carregar lead/caixa, exigir o ID estável da primeira etapa, normalizar dados legado/novo, injetar URL HTTPS absoluta do wordmark, renderizar no servidor, chamar `sendMail` e chamar RPC após retorno aceito.**

- [ ] **Step 4: Fazer retry já aceito executar novamente somente append/registro necessários; nunca chamar SMTP duas vezes com a mesma chave.**

- [ ] **Step 5: Adicionar ação ao allowlist e mapear erros públicos acionáveis sem expor detalhes internos.**

- [ ] **Step 6: Rodar todos os testes Deno, `deno check` das Edge Functions e incluir novo teste no CI; esperar sucesso.**

- [ ] **Step 7: Commitar: `git commit -m "feat: send first contact from CRM"`.**

### Task 4: Ações no card e WhatsApp

**Files:**
- Create: `src/firstContact/LeadQuickActions.tsx`
- Create: `src/firstContact/LeadQuickActions.test.tsx`
- Create: `src/firstContact/whatsapp.ts`
- Create: `src/firstContact/whatsapp.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/app.css`

**Interfaces:**
- Produces: `buildWhatsAppUrl(phone: string): string | null` usando `https://wa.me/<E164 sem +>` e assumindo BR (`55`) apenas para 10/11 dígitos nacionais.
- Produces: `<LeadQuickActions deal stage onPreview onOpenWhatsApp />`, visível apenas em “Diagnóstico pendente”.

- [ ] **Step 1: Escrever testes de telefone formatado, `+55`, inválido e internacional; escrever testes do card para botões, ausência por etapa/dado e selo com horário enviado.**

- [ ] **Step 2: Rodar os testes; esperar falha por componentes inexistentes.**

- [ ] **Step 3: Implementar normalização conservadora de WhatsApp e componente focado, sem inserir lógica nova na linha monolítica do card.**

- [ ] **Step 4: Integrar o componente no card e estilos responsivos; impedir drag quando o usuário interage com as ações.**

- [ ] **Step 5: Rodar testes e build; esperar sucesso.**

- [ ] **Step 6: Commitar: `git commit -m "feat: add lead contact actions"`.**

### Task 5: Prévia, confirmação e reenvio nos detalhes

**Files:**
- Create: `src/firstContact/FirstContactDialog.tsx`
- Create: `src/firstContact/FirstContactDialog.test.tsx`
- Create: `src/firstContact/api.ts`
- Modify: `src/DealDetails.tsx`
- Modify: `src/details.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: renderizador canônico e `invokeMailAction('send-first-contact', payload)`.
- Produces: diálogo com destinatário, assunto, visual HTML, alternativa texto, confirmação e chave UUID estável durante a tentativa.

- [ ] **Step 1: Escrever testes para abrir prévia, alternar HTML/texto, confirmar uma vez sob duplo clique, manter chave no retry, erro sem falso sucesso, refresh após sucesso e reenvio somente nos detalhes.**

- [ ] **Step 2: Rodar os testes; esperar falha pelo diálogo inexistente.**

- [ ] **Step 3: Implementar API tipada e diálogo; sanitizar prévia/usar `srcDoc` com sandbox sem scripts e nunca permitir edição do destinatário neste fluxo.**

- [ ] **Step 4: Integrar em `App` e `DealDetails`; mostrar evento/status e canais/objetivo principal novos com fallback legado.**

- [ ] **Step 5: Rodar `npm test -- --run` e `npm run build`; esperar sucesso.**

- [ ] **Step 6: Commitar: `git commit -m "feat: review first contact before sending"`.**
