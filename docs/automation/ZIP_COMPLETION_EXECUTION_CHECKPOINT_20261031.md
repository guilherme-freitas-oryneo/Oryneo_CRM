# ORYNEO — Checkpoint de execução segura do ZIP (31/10/2026)

**Natureza:** registro factual de engenharia na branch isolada; não é termo de aceite live.
**Fonte do escopo:** `ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28(5).zip`.
**Base protegida:** `main` `870d14ae07c0e52e13272721a753a6d1dc653601`.
**PR de trabalho:** [#82](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/pull/82) (**draft — não mesclar sem QA**).

## Linha de base imutável da régua

- `docs/automation/ZIP_CHECKPOINT_MASTER_20261031.md` e `qa/acceptance/checkpoint-master-20261031.json`.
- 7 fases, 70 critérios imutáveis; **baseline histórico 54/70 = 77,14%**; **revalidação F5.7 em 01/11: 54,5/70 = 77,86%**. Veja o log de delta e evidências no checkpoint mestre.
- `qa/acceptance/verify-checkpoint-oryneo.mjs` agora recalcula a porcentagem a partir dos 70 valores. Não bloqueia avanços futuros no valor original e confronta os itens com o Markdown.
- `qa/acceptance/verify-stage5.mjs` importa esse verificador na suíte de aceitação existente.
- **Não alterar a pontuação por simples escrita de código draft.** Somente mover cada item com nova evidência e registrar `antes -> depois` + SHA + ambiente + teste.

## Mudanças efetivamente realizadas na branch

1. **Checkpoint persistente:** documento + JSON, sem alterar o ZIP ou o ambiente produtivo.
2. **Oito starters opcionais para revisão interna:** `src/automation/safeStarterActionPlans.ts` oferece `buildCrmReviewStarter` que adiciona uma tarefa CRM interna à ramificação permitida, mantendo os originais inalterados e bloqueando envios. `src/automation/safeStarterActionPlans.test.ts` testa cada grafo, pagamento verificado, wait cancelável, IDs e nenhuma ação externa. Essas variantes não estão ligadas à UI ou publicadas.
3. **Endurecimento de consentimento para e-mail:** `supabase/functions/automation-api/commercialActionPolicy.ts` não trata endereço verificado como consentimento; bloqueia opt-out verdadeiro ou desconhecido e falta de opt-in. Testes Deno em `supabase/functions/tests/automation_email_consent_gate_test.ts`. Pré-validador continua explicitamente incapaz de despachar.
4. **Correção de regressão na suíte browser:** `.github/scripts/qa-automations.mjs` reconhece a ação `release-gates` adicionada pelo PR #81, com resposta falsa/controlada, `dispatchAuthorized:false` e `releaseReady:false`. Falha identificada em run #41262205975. Correção validada no [run #41262387036](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41262387036) (**success**).
5. **Separação de pós-venda preparada, sem mutação de dados:** `supabase/automation/post_sale_split_readiness.sql` é leitura pura de readiness; `src/automation/postSaleStage.ts` e `src/App.tsx` exigem segunda flag `VITE_ORYNEO_POSTSALE_BRIDGE_VERIFIED` para permitir a ocultação opcional da antiga coluna. Os testes protegem o caminho original, mesmo com flag visual ligada. **Flag de frontend não é certificação de bridge; jamais habilitar sem migrar/validar triggers.**

## Leitura SQL realmente executada (somente leitura)

```text
legacy_stage_present       true
active_legacy_deals        0
hardcoded_function_refs    1
won_stage_count            2
explicit_won_count         1
delivery_project_count     0
transition_readiness       BLOCKED_LEGACY_TRIGGER_REFERENCES
```

A função legada `crm_schedule_implementation_automation` contém referência rígida ao ID da etapa `Implantação` e agenda `implementation_started_email` sob condição financeira. Não remover, renomear ou alterar o `outcome` dessa etapa como correção isolada. É necessário um bridge validado com trigger, unicidade, idempotência, recibo e rollback.

## Evidências de CI obtidas nesta rodada

- [QA Automações #41262337926](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41262337926): **success** em commit anterior da mesma branch.
- [CRM v2 #41262337986](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41262337986): **success**, commit anterior.
- [Pix #41262338035](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41262338035): **success**, commit anterior.
- [Browser CRM v2.1 #41262387036](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41262387036): **success** após correção da action `release-gates`.
- Esses resultados não são automaticamente transferíveis para o último commit. Antes de qualquer merge, verificar os **seis workflows no SHA final** e executar novamente as verificações se necessário.

## Gates comprovadamente NÃO satisfeitos

- `automation_runtime_settings.mode='disabled'`, `emergency_stop=true`.
- 8 starters hospedados em `draft`; 0 versões publicadas, 0 fluxos ativos, 0 execuções da nova engine.
- 5/5 canais são propriedade do sistema `legacy`, 0 do `new_engine`.
- 0 atestações de release; conhecimento/dicionário SDR da engine nova não aprovados/publicados.
- Execução live de ações e-mail/SDR/Meta/wait ainda não totalmente implementada/homologada; 47/47 casos somente com evidência isolada, nenhum `liveValidated:true`.
- Sem aprovação documental jurídica/comercial comprovada nem consentimentos por destinatário.
- Sem teste autenticado canário de ponta a ponta nem restauração/rollback real de todo o ecossistema.

**Regra:** manter PR #82 em draft e a nova engine desligada; nunca ligar um worker, trocar owner, disparar template/cobrança ou mutar estágio real para satisfazer a porcentagem.

## Continuidade em outra conversa

Ler este documento, o checkpoint mestre e o relatório `docs/automation/RELEASE_ACTUAL_STATE_20261031.md`. Verificar commit de `main`, SHA do PR #82, seis CI do HEAD e flags do Supabase. Retomar pela primeira lacuna real (integrações live por adaptador; bridge implantação; oito jornadas; homologação). Não regressar percentuais sem evidência de falha concreta. Não copiar históricos de CI como teste do HEAD.

## Revalidação incremental — 01/11/2026

**Critério F5.7: 0 → 0,5** (parcial, e somente esse). Novo score auditável: **54,5/70 = 77,86%**. Aumentou porque:
- `src/automation/safeStarterActionPlans.ts`: oito variantes opcionais, todas com tarefa interna CRM, preservam fluxos originais.
- `src/automation/AutomationsWorkspace.tsx`: seleção explícita `Revisão CRM · rascunho · nenhuma mensagem` no editor.
- `src/automation/safeStarterJourneyMatrix.test.ts`: 8 jornadas com sucesso controlado, bloqueio e evento incorreto; sem efeitos externos.
- `src/automation/runtimeReadiness.ts`: aviso por tipo de nó para não confundir editor com execução live; testes específicos.
- [Suíte de automações #41263764954](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41263764954) e [Browser CRM v2.1 #41263764960](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41263764960): **success no mesmo SHA de código `8e1469775321f01feae630829f68375bf3b88626`**. A porcentagem da régua foi atualizada em commits documentais posteriores, portanto verificar o último HEAD antes de promover.

**Não concluído:** os outros 69 itens permanecem com a pontuação anterior; F5.7 não é 1,0 porque faltam fluxos completos, envios autorizados e E2E. A engine não foi ligada.

### Gates reais consultados no Supabase, somente leitura

`public.automation_release_missing_gates(workspace_id,channel)` reporta:
- Globais: `legal`, `playbook`, `rollback`, `security`, `authenticated_e2e`.
- CRM: `provider_verified`, `consent_policy`, `single_owner`.
- E-mail: os três controles acima + `mailbox_verified`.
- WhatsApp: `provider_verified`, `consent_policy`, `single_owner`.
- Onboarding: `provider_verified`, `consent_policy`, `single_owner`.
- Faturamento: `provider_verified`, `consent_policy`, `single_owner`, `financial_webhook`, `terms_accepted`.

Nenhuma dessas aprovações foi criada artificialmente. Não manipular `automation_release_attestations` para desbloquear um fluxo sem os comprovantes necessários.
