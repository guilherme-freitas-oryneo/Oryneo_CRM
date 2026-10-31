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
| WhatsApp inbound / takeover | `crm_wa_messages` / `crm_wa_conversations` / `crm_wa_automation_events` | Adaptadores com cursor; `conversation.human_takeover` só na transição canônica `sdr_active → review/human_locked` |
| Intake | `crm_intake_requests` | `lead.intake_received`, sem corpo, e-mail ou telefone |
| Checkout | `crm_billing_orders` | `checkout.started` só com sessão live canônica |
| Pagamento validado | `crm_billing_orders` + `crm_stripe_events` | `billing.paid_verified` exige live, paid_at, sessão e webhook assinado reconciliado |
| Falha / expiração | Mesma reconciliação Stripe | `billing.failed` / `checkout.expired`, sem inferir quitação |
| E-mail | `crm_events` do tipo `email_sent` | `mail.sent` (gatilho isolado) sem texto enviado, evitando loop de `opportunity.updated` |
| Proposta | `crm_proposals` | `proposal.sent` somente status sent e snapshot SHA-256 hexadecimal |
| Reunião | `crm_events` do tipo `meeting_scheduled` | `meeting.scheduled` somente após evento estruturado efetivamente escrito pelo CRM |
| Pós-venda | `crm_delivery_projects` + ordem paga | `onboarding.started` sem criar 2º e-mail de implantação |

`commercial_sources.preview.sql` cria a view `security_invoker`, cursores de **oito** fontes, deduplicação transacional e ingestão bounded em shadow; `commercial_sources.qa.sql` simula eventos tardios, históricos, proveniência Stripe, resposta humana, sandbox, duplicações e parada de emergência. A emissão de checkout usa a hora da associação canônica da sessão (não a criação anterior da ordem) e o onboarding usa o maior instante entre criação do projeto e confirmação financeira, impedindo perda de eventos por ordem de chegada.

### Isolamento e executor único

- `commercial_channel_ownership.preview.sql`: propriedade única por `whatsapp`, `email`, `crm`, `onboarding` e `billing`. Padrão = **legacy**, sem condições para liberação automática.
- `outbox_delivery_protocol.preview.sql`: agora a reivindicação de lease exige explicitamente **new_engine**, parada do legado atestada e release registrado; nenhum dispatcher novo pode reivindicar canal ainda pertencente ao legado.
- `outbox_delivery_protocol.qa.sql`: prova que um WhatsApp legado não pode ser reivindicado, seguida de cutover **somente no banco descartável** e prova de lease idempotente/sem duplicações.
- `commercial_channel_ownership.qa.sql`: testa missing attestation, stop e retorno sem autorização de transporte.
- A engine não muda ownership no ambiente real e nenhum worker legado foi desligado.

### Adaptadores de ação

- `commercial_crm_stage_adapter.preview.sql`: mudança de etapa por RPC service-role, com controle de versão publicada, target stage resolvido no snapshot congelado, oportunidade canônica, CAS por revisão, `crm_history`, `crm_events`, idempotência por `action_key` e confirmação no outbox em **uma única transação**. Faz locks de linha contra cutover e parada de emergência.
- `commercial_crm_task_adapter.preview.sql`: cria a **próxima ação** no modelo canônico existente `next_action`, respeitando tarefa humana inacabada, prazo UTC, CAS, auditoria e idempotência. Não cria uma tabela de tarefas alternativa.
- `commercial_data_grants.preview.sql`: reconcilia ACLs reais de produção em arquivo **não aplicado**. A inspeção constatou ausência de SELECT por `service_role` em `crm_intake_requests`, `crm_events` e `crm_delivery_projects`, além de falta de permissões para a escrita canônica de CRM. O manifesto libera somente SELECT de fontes, INSERT nas trilhas de auditoria e UPDATE das colunas `data`, `revision`, `updated_at` de `crm_records`. Testes garantem que `deleted`/`kind` não receberam autorização de UPDATE e que `anon` não ganhou acessos.
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

## 4. Resultado final — CI da versão de código aceita

**[GitHub Actions #41236095939](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41236095939)** — **4/4 jobs concluídos com sucesso** (versão de código `924a635fb41599e2bc49492ff6f7956ed7dd10da`).

- **CRM/Frontend:** TypeScript + build Vite aprovados; **528 testes Vitest em 79 arquivos** sem falha.
- **Navegador real:** **15/15 testes Playwright Chromium** em 390, 768, 1024 e 1440 pixels, com evidência visual arquivada.
- **PostgreSQL 17 descartável:** `phase3-commercial-sources-shadow-only-qa-passed`; `stage3-single-owner-no-send-qa-passed`; `stage3-crm-atomic-cas-rollback-no-duplicates-qa-passed`; `stage3-crm-next-action-safe-idempotent-qa-passed`.
- **Integração Deno ↔ PostgreSQL:** `oryneo-engine-db-bridge-passed`: 1 fluxo, 2 rastros persistidos, **0 efeitos externos**; typecheck e testes isolados de políticas aprovados.
- **Autorização:** grants necessários identificados por consulta somente leitura do projeto hospedado e codificados em `commercial_data_grants.preview.sql`, com negativas explícitas de update a `kind` e `deleted`. **Não aplicados ao banco de produção.**
- **Fatos fora de ordem:** source feed cobre associação tardia de sessão Stripe, pagamento após criação do projeto de onboarding, deduplicação de webhook, recebimento de resposta com handoff e recibos `mail.sent` sem recursão de `opportunity.updated`.

**Resultado técnico:** a macroetapa 3 fica homologada como implementação isolada, com canais existentes mantidos como donos exclusivos dos disparos. A troca real do executor, migrações e tráfego com provedores ficam submetidos à homologação das etapas 5–6 e à autorização de release. Não afirmar que WA/e-mail já são transportados pela engine nova.

## 5. Rollback e preservação

- PR #76 em draft, baseado em #75, sem merge e sem alterações na `main`.
- O estado `mode=disabled`, `emergency_stop=true`, workspace inativo e fluxos novos desligados deve permanecer até release.
- Testes de mudança de etapa e tarefa usam `BEGIN/ROLLBACK` em PostgreSQL descartável; não deixam dados em produção.
- Nenhuma rotina cancela envios legados ou libera cobrança. Não há envio duplo porque nenhum transporte da nova engine é habilitado e o claim de ações exige exclusividade comprovada.
- Se um gate falhar, a nova engine fica bloqueada e o sistema legado continua responsável.

**Estado de aceite:** critérios técnicos de integração validados em CI isolada; consultar a execução final indicada neste documento e no PR #76. Desenvolvimento de fontes, ownership e ações CRM foi isolado da produção. Os transportes de mensagens permanecem bloqueados até a liberação das etapas posteriores.
