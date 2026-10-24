# ORYNEO WhatsApp — continuidade da execução

Data da auditoria: 2026-10-24 UTC. Branch: `feat/whatsapp-forensic-resumption-20261024`, originada de `main` em `62e05be4701c07adf4896ca5904864f7d19e94c6`. PR draft: [#53](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/pull/53). Último commit de código verificado neste lote: `3cd0b708a48f1d5b954d75803b0dfe9d02b37dff`. CI ainda em execução na última consulta; não foi declarado verde.

## O que foi observado

- O checkout do escritório não está neste ambiente. O clone atual estava limpo, sem stash local. Isso não permite concluir que a máquina do escritório esteja limpa. Foi solicitada uma única sincronização de patch/branch caso haja trabalho local.
- Repositório canônico indicado por `README.md`: `guilherme-freitas-oryneo/Oryneo_CRM`. O repositório Polaris WhatsApp pertence a outro produto e não deve ser incorporado ao CRM ORYNEO por semelhança de nome.
- `main` em `62e05be`; PRs WhatsApp encontrados (#13–16) tratam de links/CTAs em e-mails, não de Cloud API. O PR #13 continua draft/aberto, antigo e de e-mail. Os workflows de publicação do commit `62e05be` e Pages concluíram com sucesso em 2026-10-23 (runs 39875444019, 39875507148). GitHub Pages aponta para a branch `gh-pages`; não foi feito smoke test autenticado do CRM. Há ainda um Site ORYNEO CRM v1, criado em 2026-10-10, que não prova estar sincronizado ao GitHub Pages atual.
- O código atual oferece `wa.me` na ação rápida do lead (`src/firstContact/LeadQuickActions.tsx`) e em templates de e-mail. A ação abre o WhatsApp externo. Não há inbox, adapter Cloud API ou webhook Meta versionado no repositório atual.
- Projeto Supabase correto conforme `README.md`: `ucikrafwfzamxvweuvgk`, `Oryneo-CRM`, ativo. No inventário `public`, 31 tabelas existentes com RLS, nenhuma tabela de conversa/canal/mensagem WhatsApp (apenas `crm_mail_messages`); nenhuma função SQL pública com nome WhatsApp/conversa; 44 migrations registradas, a última `20261022000841_crm_billing_obligation_single_method_per_competence`. As 21 Edge Functions ativas não incluem WhatsApp. Foram feitas apenas leituras de metadados, sem ler mensagens ou dados pessoais.
- `codex mcp list` inicialmente não tinha servidores. O MCP oficial foi cadastrado como `whatsapp_business_tools` com URL `https://mcp.facebook.com/whatsapp_business_tools`, transporte HTTP. O endpoint respondeu HTTP 405 à consulta GET sem autenticação, o que somente confirma alcance HTTP. `codex mcp list` informa **Not logged in**; não há `whatsapp_biz_*` exposta nesta sessão, negócio/WABA/número não foram lidos. Um fluxo OAuth iniciado pelo CLI requer consentimento interativo do titular e não foi concluído. Não há evidência de elegibilidade ou registro do número.
- Baseline local do repositório: `npm ci --no-audit --no-fund` e `npm test -- --run`: 41 arquivos, 255 testes aprovados. Isso valida a suíte existente no clone, não a integração WhatsApp.
- Após adicionar apenas funções puras de política e status, `npx vitest run src/whatsapp/policy.test.ts` passou (14 testes), `npm test -- --run` passou (42 arquivos, 269 testes) e `npm run build -- --base=/Oryneo_CRM/` passou. Nenhum desses testes exercitou Cloud API, banco ou um envio real.
- Após adicionar verificação pura de GET challenge e HMAC de POST sobre bytes brutos, `src/whatsapp/webhookVerification.test.ts` passou (4 testes), a suíte passou com 273/273 em 43 arquivos e o build passou. Ainda não há rota HTTP, secret configurado, persistência de eventos nem deploy do webhook.
- O rebranding da landing page está fora de escopo e não foi modificado.
- Brand Kit oficial v1.1 foi localizado e seu README lido no Drive ORYNEO; `03-DESIGN-DIRECTION.md` registra as restrições de logos e tipografia. A auditoria de policies mostrou que `crm_members` contém somente `user_id`, sem equipe/carteira; `01-AS-IS-CRM.md` detalha o impacto para o futuro módulo.

## Matriz de progresso do prompt mestre (00–21)

Status se refere à missão de WhatsApp oficial, não ao CRM inteiro. `NÃO VERIFICÁVEL` indica dependência de ambiente/conta inacessível; `NÃO INICIADO` indica ausência nos recursos remotos examinados, sem afirmar ausência no computador do escritório.

| Seção | Status | Evidência e ambiente | Lacuna, risco e próximo passo mínimo |
| --- | --- | --- | --- |
| 00 Ordem e resultado | PARCIAL | CRM React/Supabase em `main`; ação `wa.me` existente | Central oficial ainda não existe; preservar fluxos existentes e construir incrementalmente. |
| 01 Parâmetros de negócio | COMPROVADO E TESTADO | Número e marca constam no prompt; CTA `wa.me` em código | Titularidade Meta não verificada; não associar número sem leitura da conta. |
| 02 Continuidade | PARCIAL | Esta auditoria, branch isolada, testes baseline | Prosseguir por lotes e registrar commits/testes. |
| 03 MCP Meta | BLOQUEADO | Servidor cadastrado, `Not logged in` no CLI; sem ferramentas `whatsapp_biz_*` | Titular deve concluir OAuth legítimo neste contexto; depois ler businesses, accounts e phones. |
| 04 Forense CRM/Supabase | PARCIAL | GitHub `main` 62e05be; Supabase ativo: 31 tabelas, 44 migrations, 21 functions; testes 255/255 | Falta baseline em navegador autenticado, inspeção de RLS detalhada, logs e eventual material local do escritório. |
| 05 Provider/coexistência | BLOQUEADO | Não há Meta account/phone consultados; código só tem `wa.me` | Elegibilidade e coexistência do número dependem da leitura Meta; manter transporte atual intacto. |
| 06 Modelo de dados | PARCIAL | ADR de contrato em `02-ARCHITECTURE-ADR.md`; Supabase public sem tabelas WhatsApp | Falta schema, RLS, migrations e persistência; revisar identidade CRM antes de migrar. |
| 07 API/webhooks | PARCIAL | Verificador puro GET/HMAC em `supabase/functions/_shared/whatsapp/webhookVerification.ts`, testado localmente; remoto sem função WhatsApp | Falta handler HTTP, inbox durável, dedupe, retry, autorização, secret e deploy; não configurar webhook Meta agora. |
| 08 SDR/governança | PARCIAL | Política pura em `supabase/functions/_shared/whatsapp/policy.ts`, com teste local; `crm_automation_jobs` é de e-mail | Ainda não há lock persistente nem chamada da política em worker; não há garantia operacional de bloqueio. |
| 09 Direção visual | PARCIAL | README oficial Brand Kit v1.1 lido no Drive; `03-DESIGN-DIRECTION.md` | Conferir assets concretos e testar UI quando implementada. Landing fora de escopo. |
| 10 Componentes | NÃO INICIADO | Ação de lead abre aba `wa.me`; nenhuma thread/composer | Especificar e implementar com backend real, estados de erro e acesso. |
| 11 Responsividade/acessibilidade/performance | NÃO VERIFICÁVEL | Suíte atual não cobre inbox WhatsApp | Medir e testar após existir interface. |
| 12 Benchmarking | PARCIAL | `04-BENCHMARK.md`: seis fontes oficiais consultadas em 2026-10-24, com padrões e trade-offs | Falta inspeção visual/screenshot e matriz completa de elementos de UI antes de implementação. |
| 13 Segurança/LGPD | PARCIAL | RLS habilitada nas tabelas públicas existentes; nenhum webhook Meta | Auditar policies e projetar assinatura, isolamento, retenção e consentimento antes de expor rota. |
| 14 Estratégia de implementação | PARCIAL | Branch isolada criada após auditoria; suíte baseline verde | Registrar ADR, implementar atrás de flag, manter PR/CI rastreáveis. |
| 15 Matriz de testes | PARCIAL | 255 testes baseline; 18 testes novos de política/status/assinatura; suíte 273/273 e build local em 2026-10-24 | Faltam RLS, integração, UI e E2E real; os testes novos não comprovam proteção em runtime. |
| 16 Homologação do número | BLOQUEADO | Sem OAuth Meta e sem leitura de ativos | Confirmar titularidade/elegibilidade; não registrar, migrar ou desvincular número agora. |
| 17 Aceite de produto | NÃO INICIADO | Nenhum fluxo Cloud API observado ponta a ponta | Homologar somente com envio/recebimento autorizados e evidência de produção. |
| 18 Entregáveis | PARCIAL | Este checkpoint e baseline remoto | Completar documentação, código, evidências e runbook nos lotes correspondentes. |
| 19 Lotes autônomos | PARCIAL | Reconstrução concluída no ambiente atual; baseline executado | Seguir tarefas independentes, validar e fazer commits pequenos. |
| 20 Fontes atuais | PARCIAL | Endpoint Meta alcançável; código e Supabase lidos | Consultar documentação primária antes de implementar Cloud API. |
| 21 Comando de início | PARCIAL | Codex CLI identificado e MCP registrado | OAuth, inventário de ativos e implementação seguem pendentes. |

## Ordem de retomada

1. Reconciliar eventual patch do escritório quando disponibilizado. Não criar app, WABA, webhook, migração nem número redundante.
2. Concluir OAuth do MCP oficial e consultar, somente leitura, negócios, contas, número, templates e webhooks. Sem isso, a decisão de migração/coexistência permanece bloqueada.
3. Inventariar identidade CRM, policies e fluxos de automação; definir ADR de provider e contrato de eventos compatível com o esquema real.
4. Implementar e testar backend de staging e estado persistente atrás de flag, seguido de UI e regressões. Não publicar produção nem enviar mensagens reais sem dados autorizados.
5. Homologar ponta a ponta com número próprio/autorizado, revisar PR/CI e executar rollout controlado apenas quando os gates de segurança e titularidade estiverem completos.

## Próxima sessão

Conferir `git log` desta branch e este arquivo; buscar patch do escritório se houver; consultar `codex mcp list` e executar as leituras Meta após OAuth. A política pura ainda deve ser conectada, com leitura transacional do estado, à rota real de emissão. Não inferir progresso a partir de uma branch ou arquivo sem teste e sem recurso remoto correspondente.
