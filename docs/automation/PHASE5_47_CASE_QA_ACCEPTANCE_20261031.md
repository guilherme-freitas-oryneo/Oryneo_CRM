# ORYNEO — Macroetapa 5 | Homologação, 47 cenários, segurança e regressão

**Data:** 31/10/2026 · **Escopo:** QA técnico integral **isolado**, preservação de produção.  
**Base:** PR #78 → PR #77 → PR #76 → PR #75 → PR #74 → PR #72.  
**Merge, deploy, SQL em produção, Stripe live, envio Meta/SMTP, crons, cutover:** **nenhum**.

## 1. Resultado da homologação isolada

**[GitHub Actions #41240130951](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41240130951)**, head de código **ee795e2a6b2777928abab1c824cab07b742dfa72**, **5/5 jobs concluídos com sucesso**:

| Job | Resultado verificável |
| --- | --- |
| \`schema-isolation\` | PostgreSQL 17 descartável; RLS, imutabilidade, fencing, retries, rollback, waits, Meta/checkout/CRM, releases; **\`stage5-cross-stream-journey-no-effects-qa-passed\`**, compilador Deno+DB com 1 fluxo, 2 traces, **0 efeitos externos** |
| \`failure-policy\` | Typechecks da API, motor e worker SDR, tests Deno e políticas; inclui regressão de webhook Stripe assinado, checkout liquidado vs não pago, recuperação de IA e 1.000 decisões semânticas locais |
| \`crm-regression\` | **531/531 Vitest em 80 arquivos**; TypeScript, Vite, preservação do catálogo e digest do Playbook, sem alterações na execução atual do CRM |
| \`editor-browser-qa\` | **22/22 testes Chromium Playwright**, incluindo 390/768/1024/1440px, touch nativo em Chromium, teclado, preferência por movimento reduzido, canvas, menus, arestas, persistência, prévia e 0 chamadas a Meta/Stripe/OpenAI durante simulações |
| \`acceptance-coverage\` | **47/47 IDs oficiais** com referências a evidências executáveis verificadas; artefato JSON emitido para auditoria. Não é uma declaração de 47 execuções live independentes. |

**Prova adicional de latência interna:** 1.000 turnos sintéticos de classificador + recuperação de conhecimento, **p50=0,527 ms; p95=0,811 ms** na máquina do CI. **Não são latência da OpenAI, tempo de envio WhatsApp nem custo real de tokens.** Das 1.000 decisões, 285 exigiram revisão humana e 715 produziram conhecimento de referência apto apenas para uma resposta simulada. Custos/tokens/tempos de provedores externos **não foram medidos**; não substitua essas métricas por estimativas.

## 2. Cobertura rastreável dos 47 critérios do ZIP

Origem: \`ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28/qa/matriz_aceite.csv\` — 47 IDs distribuídos em:

| Grupo original | Quantidade | Evidência |
| --- | ---: | --- |
| Baseline \`B01–B03\` | 3 | Digest do Playbook/catálogo, verificação Meta, cadeia de PRs preservada (B03 é auditoria de GitHub, não teste E2E de cliente) |
| SDR \`S01–S13\` | 13 | Persistência inbound, dedup de webhook, classificação, Responses incompleto/vazio, 429/5xx, retomada, takeover, opt-out, pagamento só canônico |
| Pipeline \`P01–P10\` | 10 | Contratos de intake/checkout, streams correlacionados em PostgreSQL descartável, webhook assinado, idempotência, estágio e onboarding |
| Editor \`E01–E12\` | 12 | Canvas real no navegador, portas e grafos tipados, undo/redo, 3 condições reabertas, negações, mock \`assumeApproved\` sem envio |
| Política \`C01–C06\` | 6 | 24h, template Meta pausado, RBAC, lease/fencing de dois workers, entrega incerta e ciclos inválidos |
| Conhecimento \`K01–K03\` | 3 | Comercial vinculado, hash/versionamento, prompt injection e fontes confiáveis |

A matriz foi verificada por \`qa/acceptance/verify-stage5.mjs\`, com evidências ancoradas e consultáveis em \`qa/acceptance/stage5-evidence-map.json\`. O relatório \`stage5-evidence.json\` atribui **nível de cobertura**, origem e job para cada ID. Distribuição:

- **28** referências de teste unitário, **10** de integração SQL descartável, **3** de navegador, **3** de teste de componente, **2** de componente UI e **1** de auditoria GitHub somente leitura.
- Há **reutilização intencional de testes** quando cobrem mais de um cenário; o resultado não representa 47 testes novos nem 47 jornadas reais executadas de ponta a ponta.
- Cada referência foi conferida pela ferramenta automatizada e seus jobs subjacentes passaram. Os testes de navegadores foram Chromium local de fixture, não sessões autenticadas da produção.
- Casos que dependem de prova live (e.g. Meta suspender uma mensagem entre o preflight e o dispatch real, autenticação final do usuário, entrega de webhook real sob carga, custo OpenAI, SLA comercial de atendimento) **não receberam homologação em produção**.

## 3. Integração comercial e política — verificações adicionais novas

- \`supabase/automation/stage5_cross_stream_journey.qa.sql\`: integra em PostgreSQL descartável as referências canônicas de **intake → checkout → pagamento assinado representado no journal → onboarding**, garantindo que todas apontem à mesma oportunidade e ao mesmo pedido, sem associação antecipada de checkout pendente como pago. Eventos de falha/expiração ficam separados, replay não duplica inbox, nenhuma informação pessoal/prompt vaza nos \`context_refs\` e nenhuma saída é enfileirada.
- \`supabase/functions/tests/automation_stage5_sdr_recovery_test.ts\`: casos sintéticos de retomada após intervalo, carência/cancelamento para revisão humana, três mensagens sequenciais, takeover após geração, 24 horas vencidas, consentimento e opt-out.
- \`supabase/functions/tests/automation_stage5_local_perf_test.ts\`: 1.000 decisões de risco e busca interna no mesmo turno, com dados artificiais e métricas p50/p95; nenhuma chamada aos provedores.
- \`qa/automation-editor/editor.pw.ts\`: quatro casos adicionais Chromium de menu direito do nó/canvas, nó órfão, touch real 390px/teclado/reduced-motion e simulação com interceptação para **zero chamadas a Graph API, Stripe ou OpenAI**.
- Adicionados à suíte Deno de regressão contratos Stripe com assinaturas forjadas/expiradas, pagamento assíncrono e falhas de checkout.

## 4. Auditoria de segurança e desempenho do Supabase (somente leitura)

O banco real foi inspecionado, sem instruções SQL de escrita. Os advisors oficiais identificaram:

| Achado | Quantidade | Interpretação e tratamento |
| --- | ---: | --- |
| [RLS habilitada sem política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | **22 tabelas** | Verificação complementar confirmou **0 permissões diretas SELECT para \`anon\` ou \`authenticated\`** nas 22; sem política, RLS não concede acesso. Este alerta não é evidência de vazamento. Preservado o isolamento existente. |
| [Funções SECURITY DEFINER executáveis por usuários autenticados](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | **4 RPCs existentes** | \`crm_add_note\`, \`crm_mutate\`, \`crm_set_action\`, \`crm_undo\`. Inspeção do código confirmou guarda por \`crm_members\`, mas **a autorização granular por operação/objeto merece revisão antes de ampliar privilégios**. Nenhuma RPC foi alterada no PR. |
| [Proteção de senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | **1 aviso de Auth** | Controle de conta preexistente. **Pendente de avaliação/ativação autorizada**; não foi alterado silenciosamente. |
| [FKs sem índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) | **13** | Oportunidade de otimização; não implica defeito funcional e não autoriza criar índices sem plano de migração. |
| [Índices sem uso registrado](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) | **41** | Telemetria indicativa, não prova de redundância. Não remover índices somente por esse aviso. |

**Status dos alerts:** findings reconhecidos e classificados; não ocultar pendências nem declarar auditoria de segurança de produção “sem avisos”. O parecer desta etapa vale para isolamento, integridade dos fluxos e superfícies exercitadas; uma revisão de acesso real/segredos/escopo das RPCs permanece no gate de produção.

## 5. Garantias de preservação / bloqueios de release

1. O PR #78 permanece **draft** sobre o PR #77, encadeado com as entregas 1–4; \`main\` e os originais não foram sobrescritos.
2. Runtime Supabase hospedado permanece \`disabled\`, \`emergency_stop=true\`, workspace inativo, sem fluxos habilitados, execuções ou outbox ativas da nova engine.
3. Os templates oficiais Meta já auditados não foram editados nem enviados; nenhum contato, cliente, e-mail, pagamento ou mensagem foi gerado pelos testes.
4. Não aplicar migrations em produção, não habilitar a nova engine, não alterar ownership dos cinco canais e não executar cutover sem homologação/autorizações da Etapa 6.
5. O SDR IA/WhatsApp legado conserva sua operação; novos artefatos são exclusivamente QA/diagnóstico nesta branch.

## 6. Qualidade do aceite e próximos gates

**Aceite da engenharia isolada da Macroetapa 5: concluído**, com todos os 5 jobs verdes e rastreabilidade completa dos 47 IDs.

**Isso não é uma homologação operacional live.** Para a etapa final ainda faltam: aprovação explícita das fontes/termos aplicáveis, avaliação dos 4 RPCs e do aviso de proteção de senhas, testes/canário autenticados controlados com provedores quando permitido, métricas reais (latência, tokens/custos, resposta e SLA), migrações, confirmação dos responsáveis por canais, plano de observabilidade e rollback e autorização de deploy/cutover.

**Rollback atual:** não integrar PR #78 ou revertê-lo. Nenhum dado nem configuração real foi alterado por esta etapa.
