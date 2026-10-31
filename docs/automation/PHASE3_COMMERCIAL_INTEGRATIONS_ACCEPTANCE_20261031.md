# ORYNEO — Macroetapa 3 | Integração comercial canônica e executor único

**Checkpoint técnico — 31/10/2026**  
**Base:** PR #75 (Etapa 2), que herda #74 e #72.  
**Alterações:** PR #76, branch `feature/oryneo-commercial-integrations-stage3-20261031`.  
**Modo:** engenharia e QA em ambiente isolado. Sem envio, cobrança, merge, deploy ou banco de produção alterado.

## 1. Escopo implementado

A presente macroetapa é o equivalente de integração comercial à Fase 4 do ZIP original. Os eventos externos são normalizados a partir do **registro canônico interno** — não de uma mensagem, navegador ou status Stripe fornecido por um lead.

### Fontes, eventos e origem da verdade

| Canal/evento | Origem canônica | Contrato e proteção |
|---|---|---|
| Nova oportunidade / mudança de etapa | `crm_events`, `crm_records` | Adaptador CRM pré-existente, cursor idempotente por evento |
| WhatsApp inbound / takeover | `crm_wa_messages` / `crm_wa_conversations` | Adaptador pré-existente, deduplicação + limites de consentimento/mode |
| Intake | `crm_intake_requests` | `lead.intake_received`, sem corpo, e-mail ou telefone |
| Checkout | `crm_billing_orders` | `checkout.started` só com sessão live canônica |
| Pagamento validado | `crm_billing_orders` + `crm_stripe_events` | `billing.paid_verified` exige live, paid_at, sessão e webhook assinado reconciliado |
| Falha / expiração | Mesma reconciliação Stripe | `billing.failed` / `checkout.expired`, sem inferir quitação |
| E-mail | `crm_events` do tipo `email_sent` | `opportunity.updated` sem simular texto enviado |
| Proposta | `crm_proposals` | `proposal.sent` somente status sent e snapshot SHA-256 hexadecimal |
| Reunião | `crm_events` do tipo `meeting_scheduled` | `meeting.scheduled` somente após evento estruturado efetivamente escrito pelo CRM |
| Pós-venda | `crm_delivery_projects` + ordem paga | `onboarding.started` sem criar 2º e-mail de implantação |

`commercial_sources.preview.sql` cria a view `security_invoker`, cursores de sete fontes, deduplicação transacional e ingestão bounded em shadow; `commercial_sources.qa.sql` simula eventos tardios, históricos, provedores inválidos, sandbox Stripe, duplicações e interdição por emergency stop.

### Isolamento e executor único

- `commercial_channel_ownership.preview.sql`: propriedade única por `whatsapp`, `email`, `crm`, `onboarding` e `billing`. Padrão = **legacy**, sem condições para liberação automática.
- `outbox_delivery_protocol.preview.sql`: agora a reivindicação de lease exige explicitamente **new_engine**, parada do legado atestada e release registrado; nenhum dispatcher novo pode reivindicar canal ainda pertencente ao legado.
- `outbox_delivery_protocol.qa.sql`: prova que um WhatsApp legado não pode ser reivindicado, seguida de cutover **somente no banco descartável** e prova de lease idempotente/sem duplicações.
- `commercial_channel_ownership.qa.sql`: testa missing attestation, stop e retorno sem autorização de transporte.
- A engine não muda ownership no ambiente real e nenhum worker legado foi desligado.

### Adaptadores de ação

- `commercial_crm_stage_adapter.preview.sql`: mudança de etapa por RPC service-role, com controle de versão publicada, target stage resolvido no snapshot congelado, oportunidade canônica, CAS por revisão, `crm_history`, `crm_events`, idempotência por `action_key` e confirmação no outbox em **uma única transação**. Faz locks de linha contra cutover e parada de emergência.
- `commercial_crm_task_adapter.preview.sql`: cria a **próxima ação** no modelo canônico existente `next_action`, respeitando tarefa humana inacabada, prazo UTC, CAS, auditoria e idempotência. Não cria uma tabela de tarefas alternativa.
- `graphGuard.ts`: valida `crm_task` apenas com título e prazo tipados; continua rejeitando ações não homologadas e não concede permissão de envio a rascunhos.
- `commercialActionPolicy.ts` + `commercialAdapterPlanner.ts`: políticas puras, sem transportes, para WhatsApp, e-mail, CRM e billing somente leitura; roteamento por referências UUID, deduplicação estável, opt-out, consentimento, janela WA, aprovação do template e proprietário exclusivo. Todo plano retorna `dispatchAuthorized:false`.

### Interface de acompanhamento

- A API autenticada `commercial-readiness` devolve apenas proprietário, status do runtime e indicadores booleanos de preparo, sem IDs de provedor, e-mail, cliente ou tokens.
- A área `Templates e canais` do editor exibe estado de cada um dos cinco canais, sem botão de cutover, cobrança ou envio.

## 2. Verificações e requisitos de aceite

Os testes são executados em quatro jobs via `.github/workflows/qa-oryneo-automations.yml`:

1. `schema-isolation`: PostgreSQL 17 descartável; adaptações de CRM, Stripe, onboarding, propostas/reuniões, ownership, action outbox, manipulação de etapa e próxima ação. Testes de falhas, rollback, idempotência e **zero efeitos externos**.
2. `failure-policy`: Deno typecheck do backend, execução compilada, teste de hydrated signed Stripe, segurança dos provedores, canal, refs e idempotência.
3. `crm-regression`: TypeScript/Vite, integridade do playbook e regressão de frontend/CRM/WhatsApp.
4. `editor-browser-qa`: Chromium real, quatro larguras e fluxos do Pipeline/SDR, incluindo drag/connect e persistência.

Não executar `*.preview.sql` em produção automaticamente. Migração definitiva exige reconciliação do banco hospedado, revisão de grants, integração com API de release, plano de rollback e janela autorizada.

## 3. Limites deliberados e dependências seguintes

**Engenharia de integração não é autorização de operação.** Os canais de e-mail e WhatsApp atualmente possuem transportes legítimos no CRM antigo. Esta entrega preserva-os; o planejamento de handoff é não emissor. A seleção de variáveis dos templates Meta depende do catálogo e da semântica revisados na Macroetapa 4. A verificação dos 47 casos completos ocorre na Macroetapa 5. Execução de migrações, troca efetiva de proprietário e habilitação progressiva em produção ocorre somente na Macroetapa 6 com aprovação.

Não alegar que e-mail ou Meta já foram disparados pelo novo motor. Não alegar que reunião foi criada se o CRM não escreveu `meeting_scheduled`: o adaptador está preparado para observar fatos canônicos, nunca fabricá-los. O checkout com obrigações assistidas também não gera novos eventos `paid_verified` sem um mapeamento de liquidação própria confirmado por sua trilha financeira.

## 4. Rollback e preservação

- PR #76 em draft, baseado em #75, sem merge e sem alterações na `main`.
- O estado `mode=disabled`, `emergency_stop=true`, workspace inativo e fluxos novos desligados deve permanecer até release.
- Testes de mudança de etapa e tarefa usam `BEGIN/ROLLBACK` em PostgreSQL descartável; não deixam dados em produção.
- Nenhuma rotina cancela envios legados ou libera cobrança. Não há envio duplo porque nenhum transporte da nova engine é habilitado e o claim de ações exige exclusividade comprovada.
- Se um gate falhar, a nova engine fica bloqueada e o sistema legado continua responsável.

**Estado de aceite:** validar somente após última CI 4/4 verde. Desenvolvimento de fontes, ownership e ações CRM foi isolado da produção. Os transportes de mensagens permanecem bloqueados até a liberação das etapas posteriores.
