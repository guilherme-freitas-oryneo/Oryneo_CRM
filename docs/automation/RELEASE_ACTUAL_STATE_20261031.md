# ORYNEO — Estado real da release de Automações (31/10/2026)

Esta é a evidência consolidada **posterior à publicação**. Substitui os estados históricos "não implantado" dos runbooks anteriores; não transforma QA isolado em aceite de operação live.

## Código e frontend
- PR #80 integrado à release #79; PR #79 mesclado à `main` no commit `dcbc2ec685eddf50f297256488b3524380cefc26`.
- O GitHub Actions `41252123749` publicou a interface na `gh-pages` no commit `610676b3328b1c5650a00b8b6cc68e3ebb8d8fb2`, com resultado **success**.
- Verificados `CNAME` original, `index.html` na raiz e espelho `Oryneo_CRM/index.html`, `assets/AutomationsWorkspace-*.js/css`, área `qa/pr-46` e conteúdo jurídico de homologação pré-existente.
- Smoke público HTTP **aprovado** no workflow `41252646512`; smoke de navegador Chrome real em 390 px e 1440 px **aprovado** no workflow `41253065975`, com login visível, sem overflow horizontal, screenshots e sem efeitos externos. O smoke Chromium/WebKit separado `41252213375` ainda exige acompanhamento de status, não é substituído pela prova Chrome.
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

## Verificação final de integridade do pacote original
Arquivo local anexado: `ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28(4).zip`, com **18 arquivos**. Foi reexecutado `sha256sum -c MANIFEST_SHA256.txt` na extração local e **todas as 16 entradas verificáveis** foram aprovadas. O arquivo `qa/matriz_aceite.csv` possui **47 IDs únicos**: 3 baseline, 13 SDR, 10 pipeline, 12 editor, 6 policies, 3 knowledge; 37 casos rotulados `automated`, 9 `ui`, 1 `integration`. A cobertura documental e isolada é rastreável; essas classificações não comprovam execução operacional com serviços reais.

## Resultado e limites do aceite
**Macroetapa 6:** fechamento de código, testes isolados, merge e documentação comprovados. 
**Macroetapa 7 — release técnica:** UI publicada e smoke HTTP/Chrome concluídos; backend e banco hospedados com interlocks. **Ativação operacional de WhatsApp, SDR, e-mail e cobrança NÃO homologada e NÃO executada** por ausência dos gates de consentimento, aprovação de conhecimento, agendamento/cutover e canário real. Não atribuir 100% operacional ao ZIP enquanto esses requisitos estiverem pendentes.

A validação de Chrome teve uma primeira tentativa interrompida por erro interno `npm` no runner; a correção usou o ChromeDriver oficial pré-instalado sem dependência adicional. O workflow sucessor `41253065975` passou em ambas as resoluções e preservou capturas.


## Atualização final de governança e publicação — PR #81 (31/10/2026)

- **Release técnica integrada** pelo PR [#81](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/pull/81), commit de merge `435138903b2ea81f6d798048cbac79dbf09fa8cb`. Código de UI e rotas de leitura publicado no GitHub Pages, HEAD `b26a93a085b743e4cd59663a1867be1fc8b63577`.
- **Testes no HEAD de revisão** `d4a6248c3b4d5e2bd8fecaab853a8d2b858a922c`: [QA de Automações 5/5](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41254408854), incluindo reexecução da migração de banco, testes de papéis, revogação, retomada e navegador do editor; checks de build do CRM, Pix e CORS também verdes.
- **Smoke pós-publicação** sem autenticar, enviar mensagens ou cobrar: [HTTP success](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41254884902) e [Chrome 390/1440 px success](https://github.com/guilherme-freitas-oryneo/Oryneo_CRM/actions/runs/41254890926). Comprovadas presença do login, ausência de scroll horizontal e capturas de tela.
- **Banco hospedado**: aplicada migração versionada `20261031235900_oryneo_release_attestation_interlock_dormant.sql`. Tabela `automation_release_attestations` com RLS ativo, sem SELECT de `anon`/`authenticated`; RPC `automation_release_missing_gates` sem EXECUTE público; gatilhos negam modo live, cutover por canal e novos leases sem evidência atual, e revogação dispara kill switch.
- **Edge Functions**: `automation-api` v9 (novo endpoint autenticado `release-gates` somente leitura); `automation-meta-template-worker` v2 (revalidação de evidência de release antes de POST). Ambos redeployados com JWT obrigatório, com arquivo de entrada comparado com fonte do PR. O planejador CRM e demais Edge Functions permanecem como antes.
- **Proteção de versões**: `backup/oryneo-main-before-release-gates-20261031` aponta para `b35d5bb4aa93ee720525588d82b5a68e9435d6d7` e `backup/oryneo-pages-before-release-gates-20261031` para `610676b3328b1c5650a00b8b6cc68e3ebb8d8fb2`; o rollback real NÃO foi testado.
- **NO-GO em produção**, conferido novamente: runtime `disabled`, parada de emergência `true`, 0 execuções, 0 eventos, 0 outbox, 0 fluxos ativados, 5/5 canais legados, 0 atestações e 0 provedores novos em execução. As oito versões starter ainda são `draft`, compostas majoritariamente por trigger/condition/stop/end, não se pode apresentá-las como 8 jornadas live.
- **Criterios externos ainda por resolver**: a matriz jurídico-operacional de 19/10/2026 está explicitamente marcada `NÃO PUBLICAR`; cadastro oficial, contrato, cancelamento, reembolso, LGPD/DPA e checkout dependem de decisão/revisão humana. Playbook e intent dictionary da nova engine continuam em `draft` sem aprovação. Para qualquer cutover live é obrigatório autorizar política de consentimento/opt-out, executor único, monitoramento e rollback provado. E-mail/Meta/IA/wait ainda não possuem todos os caminhos live versionados. CI sintético ou aprovação de template Meta não comprovam consentimento de contato nem teste financeiro real.
- **Segurança residual**: os advisors ainda sinalizam quatro funções `SECURITY DEFINER` legadas executáveis por `authenticated` (com checagens internas) e proteção contra senhas vazadas desligada. Sem mudanças nesses sistemas fora do escopo desta release.

**Distinção central:** governança de release, frontend e infraestrutura foram implantados; objetivo integral de execução multicanal, SDR atualizado e homologação live **não chegou aos 100%**. Não relaxar os bloqueios ou fabricar evidências para afirmar conclusão.
