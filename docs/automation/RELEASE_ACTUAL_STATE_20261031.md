# ORYNEO — Estado real da release de Automações (31/10/2026)

Esta é a evidência consolidada **posterior à publicação**. Substitui os estados históricos "não implantado" dos runbooks anteriores; não transforma QA isolado em aceite de operação live.

## Código e frontend
- PR #80 integrado à release #79; PR #79 mesclado à `main` no commit `dcbc2ec685eddf50f297256488b3524380cefc26`.
- O GitHub Actions `41252123749` publicou a interface na `gh-pages` no commit `610676b3328b1c5650a00b8b6cc68e3ebb8d8fb2`, com resultado **success**.
- Verificados `CNAME` original, `index.html` na raiz e espelho `Oryneo_CRM/index.html`, `assets/AutomationsWorkspace-*.js/css`, área `qa/pr-46` e conteúdo jurídico de homologação pré-existente.
- Smoke público Chromium/WebKit: workflow `41252213375` acionado após a publicação; **seu resultado exige consulta ao Actions**. Não declarar sucesso apenas por ter sido iniciado.
- Smoke HTTP real do domínio `crm.oryneo.com.br`: workflow `41252646512` **success**; confirmou HTML, JavaScript compilado, logo, rotas de contratação/pagamento e espelho de compatibilidade sem lead/cobrança.
- No HEAD de release `e88787d1f84450c7d08abbe23faa8598ddd7452b`, os seis workflows de PR terminaram em **success**, inclusive a homologação de interface CRM v2.1 e o replay SQL das sete migrações.
- Backups preservados ANTES do release: `backup/oryneo-main-pre-automacoes-20261031` SHA `9fb514e7e3f831dee8861176ba7435ba23ba91d4` e `backup/oryneo-gh-pages-pre-automacoes-20261031` SHA `90cb5b58b7acb5081fd0e70410a18a00911454ae`. Rollback executado/testado: **não**.

## Supabase — migrações efetivamente aplicadas
Apliquei e registrei em `supabase/migrations` os mesmos scripts (sem `BEGIN/COMMIT` externos), nas versões reais:
- `20261031230725_oryneo_macro6_crm_canonical_planner_dormant`
- `20261031230742_oryneo_macro6_crm_cursor_dormant`
- `20261031230746_oryneo_macro6_crm_continuations_dormant`
- `20261031230750_oryneo_macro6_crm_prearm_disabled`
- `20261031230754_oryneo_macro6_observability_dormant`
- `20261031230759_oryneo_macro6_meta_template_fencing_dormant`
- `20261031230803_oryneo_macro6_meta_receipt_dormant`

O CI de automações reexecutou as sete migrações em PostgreSQL 17 descartável e passou (workflow `41251684978`, 5/5 jobs). Novo banco: seis tabelas com RLS ativo, nenhuma com SELECT para papéis públicos, 15 RPCs novas sem EXECUTE para `anon/authenticated`. O teste negativo na produção confirmou que `mode=disabled` e `emergency_stop=true` bloqueiam ingestão CRM e claim WhatsApp.

## Edge Functions hospedadas
- `automation-api` **v8**, JWT obrigatório. Base de restauração v7 conferida byte a byte contra 11 arquivos do commit `3673bf554cec23a386de62cf28ce6901a15f8c64`; restauração ainda **não ensaiada**.
- `automation-shadow-worker` **v4** e `automation-commercial-crm-worker` **v1**, preservadas.
- `automation-live-crm-plan-worker` **v1** e `automation-meta-template-worker` **v1**, ambas com JWT obrigatório e flags de envio/processamento desligadas.

## Provedor e interlocks reais
- Conta empresarial ORYNEO verificada no conector oficial. Canal de produção e número coincidiram com o CRM; criada uma vinculação de transporte **disabled**, sem aprovação, sem liberar dispatch.
- Catálogo oficial: 44 templates com status APPROVED (42 MARKETING e 2 UTILITY), 44/44 correspondentes em ID, nome, idioma, categoria e status ao Supabase.
- Marketing exige consentimento separado e verificável; a nova tabela de opt-ins segue vazia. Não usar aprovação de template como permissão para abordar pessoa real.
- Pós-publicação: `mode=disabled`, `emergency_stop=true`, 0 workspaces ativos, 0 fluxos habilitados, 0 inbox, 0 outbox, 0 execuções novas, propriedade `legacy` de 5/5 canais e `new_engine` de 0/5.

## Evidências de qualidade
- Última revisão antes do merge: 6 workflows aprovados na branch `2ef68126762696e6fe74a327bdc6157b483d2433`; o commit posterior `e88787d1f84450c7d08abbe23faa8598ddd7452b` altera **somente o workflow de QA** e homologou o replay das novas migrações.
- Suíte automatizada de Automações: 5/5 jobs, PostgreSQL 17 + compilador Deno end-to-end sintético, 532 testes Vitest, 22 testes Playwright e 47 casos mapeados em evidências **isoladas**. Isto não equivale a 47 resultados live.
- Advisors ainda apontam avisos preexistentes: 4 CRM RPCs `SECURITY DEFINER` acessíveis a usuários autenticados com checagem explícita de `crm_members` e proteção contra senhas vazadas desabilitada. Não se alterou o contrato existente dessas RPCs.

## Gate de ativação — NÃO HOMOLOGADO
A publicação do frontend, banco e Edge **não** ativou automações de produção. Ainda faltam: aprovação jurídica/comercial das fontes, release SDR (`automation_knowledge_release` ainda em `draft`), executor live de e-mail, geração live de ações Meta/SDR por grafo publicado, consentimentos e políticas por destinatário, canário autenticado com provedores, provas de dispatcher único por canal, rollback de ponta a ponta e observação de comportamento/custo após cutover.

**Regra:** não ativar `mode=live`, `enabled` de flows ou `owner=new_engine` enquanto esses gates não forem individualmente comprovados. Não enviar mensagens, não cobrar nem movimentar oportunidades reais apenas para afirmar progresso.

## Fontes de verificação
- PRs: https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/pull/79 e /pull/80
- Release/página: https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41252123749
- CI: https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41251684978
- Smoke público: https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41252213375
