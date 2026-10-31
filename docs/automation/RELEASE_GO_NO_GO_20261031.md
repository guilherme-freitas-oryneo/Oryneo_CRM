# ORYNEO — Release unificada de Automações | Gate de produção

**Auditoria:** 31/10/2026. **Origem:** ZIP `ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28(4).zip`. **Estado:** NO-GO para execução live; GO para testes de integração em branch isolada.

## Fonte e reconciliação

- Base `main`: `9fb514e7e3f831dee8861176ba7435ba23ba91d4`.
- Cabeça consolidada e testada da macroetapa 5: `066d96e435e3bfbdf48a2659ddfc88a737f34224`.
- Proveniência: PRs #72 → #74 → #75 → #76 → #77 → #78. #73 é um protótipo substituído e **não** deve ser integrado.
- Comparação GitHub `main...feature/oryneo-e2e-acceptance-stage5-20261031`: 507 commits à frente, 0 atrás; não há conflito de ancestralidade na data da auditoria.
- O novo PR consolidado direcionado à `main` **serve apenas para validação e revisão**. A publicação do CRM é automática por `.github/workflows/publicar-crm-pages.yml` após merge (push na `main`); portanto NÃO mesclar um PR incompleto.

## Evidências de engenharia já disponíveis

- CI de 31/10: workflow `41240414862` aprovado, em cima do head da etapa 5. Antes disso, `41240130951` aprovou cinco jobs.
- Suítes registradas no relatório da etapa 5: 531/531 Vitest, 22/22 Chromium Playwright, PostgreSQL 17 descartável, teste Deno e rastreabilidade de 47 IDs.
- **Limite da prova:** nenhum dos 47 critérios está marcado `liveValidated: true`; testes reaproveitados cobrem vários IDs. Nem todos são E2E independentes.
- A API `automation-api` v6 e o `automation-shadow-worker` v3 estão implantados no Supabase. A presença dessas funções NÃO comprova autorização de envio nem funcionamento da nova engine em live.

## Snapshot hospedado obtido por leitura

```
automation_runtime_settings.mode = disabled
automation_runtime_settings.emergency_stop = true
automation_flows: 8; enabled = false
automation_flow_versions: 8; status = draft
automation_executions = 0
automation_event_inbox = 0
automation_action_outbox = 0
automation_template_registry: 44 APPROVED
automation_knowledge_release: 1 draft
```

O SDR WhatsApp **legado** permanece preservado; o histórico da fila própria do SDR não equivale a execuções da engine de Automações.

## Confirmação adicional de bloqueio jurídico e drift de backend

- Fonte institucional identificada no Drive da ORYNEO: **`ORYNEO LTDA | MATRIZ DE REVISÃO JURÍDICA E LIBERAÇÃO | INTERNO | 19-10-2026`**, documento de 19/10/2026, determina **NÃO PUBLICAR** a minuta v0.9 sem aprovação legal/comercial, verificação cadastral, política de privacidade/DPA, cancelamento/reembolso, exibição integral dos termos antes do aceite e homologação financeira. Não existe, nesta auditoria, prova de superação desses gates por documento mais recente.
- Fonte vinculada: [Matriz interna de liberação](https://docs.google.com/document/d/1X_MKTDrktwLakn_Mwttu2sFuPOMbDua1CR-3YxRVoTU/edit). O documento é referência de decisão, não validação jurídica automática.
- Leitura das Edge Functions hospedadas evidenciou **desalinhamento com o último código da branch**: `automation-api` v6 tem `index.ts` de 20.031 caracteres, enquanto o arquivo final tem 31.908; `automation-shadow-worker` v3 tem entrada de 8.027 caracteres contra 13.417 no branch. Estes arquivos NÃO são byte a byte idênticos. O backend recém-proposto precisa de deploy versionado **depois** de comparar todos os módulos importados, contratos RPC e schemas; não assumir que a versão hospedada já corresponde à última suíte CI.

## Bloqueios para GO em produção (técnicos, não meramente administrativos)

1. **Executor de produção ausente/inativo.** `automation-api` aceita `publish-disabled`, mas bloqueia `publish`, `execute` e `send` com `RUNTIME_DISABLED`; o worker atual é `shadowOnly`, e o executor CRM é limitado a canal CRM e não está implantado. **Não alterar `mode` ou flags para `live` como atalho.**
2. **Publicação efetiva de conhecimento.** Release e dicionário de intenções ainda são rascunho, `enabled=false`; validar autoridades comercial/jurídica, digest e fluxo de rollback antes de aplicá-los ao SDR real.
3. **Ownership e dispatch.** Implementar e homologar worker durável por canal, prevenção de duplicidade sob concorrência, lease/fencing, política Meta fresca no envio, consentimento/opt-out, janela de 24h, dedupe no provedor, reconciliação de resultados incertos, retry/kill-switch e corte atômico do legado. Não tocar nos envios atuais até haver executor único por canal.
4. **Versões e transição do CRM.** Publicação autenticada e irrevogavelmente auditada de versões; migração cuidadosa dos nomes das etapas com IDs e históricos preservados; garantir compatibilidade de gatilhos legados.
5. **Homologação operacional.** Sessão autenticada de usuário autorizado, pelo menos um fluxo completo por integração autorizada em canário; medir latência/custo OpenAI e SLA com limites de gasto; provar rollback. Não usar dados de cliente reais como fixtures, nem enviar mensagens ou cobranças de teste sem destinatários/contas de teste controlados.
6. **Segurança da base preexistente.** Antes de ampliar acessos, revisar operação/objeto dos quatro RPCs `SECURITY DEFINER` (`crm_add_note`, `crm_mutate`, `crm_set_action`, `crm_undo`), confirmar `crm_members` e políticas RLS/grants. Auth leaked-password protection estava desabilitada (requer avaliação de impacto e mudança deliberada). Os 22 alertas de RLS sem policy não foram classificados como vazamento por si sós.
7. **Go-live/rollback.** Verificar backups de tabelas/fluxos e função ativa, capacidade de restaurar frontend `gh-pages`, versões Edge e migrations; aplicar em ordem e monitorar logs com responsável designado.

## Sequência mínima de release

1. CI em PR final que compare **toda a cadeia** com a `main`: build TypeScript, Vitest, Deno, SQL17, Playwright 390/768/1024/1440, Playbook/Catalogo, regressão Stripe/WhatsApp. Reler configurações atualizadas antes de qualquer merge.
2. Validar todos os bloqueios anteriores, com evidências independentes; registrar GO/NO-GO assinado pela engenharia/negócio. Publicar frontend somente quando as rotas e endpoints da interface puderem funcionar para o usuário autorizado.
3. Confirmar snapshot/backup e monitoração; aplicar migrações faltantes de forma idempotente com checks no Supabase e rollback; nunca reaplicar cegamente as já implantadas.
4. Publicação progressiva com flag OFF, validação de login, CRUD de rascunhos, grafos, inspeção, simulação sem efeito; capturas nas quatro larguras.
5. Canário autenticado com canais de teste e responsáveis verificados; observabilidade por nó, custos, reversão; somente depois admitir `shadow` e `live` e trocar ownership de cada canal isoladamente.
6. Reexecutar 47 critérios na modalidade cabível; marcar explicitamente o subconjunto confirmado em live. Só declarar **100%** quando houver provas de publicação + acionamento real autorizado + recuperação e rollback.

## Invariantes

- Nunca sobrescrever o treinamento já funcional do SDR ou credenciais/chaves de provedores.
- Nunca inferir pagamento pela linguagem do lead; apenas webhook Stripe autenticado e ordem reconciliada.
- Marketing/tráfego e landing page apenas em combinação com plano elegível.
- Nenhum envio real por clicar em simular/preview; nenhuma liberação mediante `assumeApproved`.
- Preservar `main`, `gh-pages`, PRs originais e histórico. Não rodar migração destrutiva sem autorização específica e backup conferido.

**Decisão técnica nesta auditoria: NO-GO para merge e dispatch live.** Isso não invalida os testes já aprovados; impede apenas confundir sua aprovação com homologação do sistema publicado. 
