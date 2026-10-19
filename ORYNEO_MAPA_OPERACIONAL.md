# ORYNEO — mapa operacional da auditoria de interações V2

Checkpoint: 2026-10-19 UTC. Este mapa foi reconstruído do repositório, GitHub Actions, Supabase, Stripe e documentos históricos do Drive. O ZIP original, a conversa anterior, o relatório de gaps e o runbook não estão disponíveis neste workspace nem foram encontrados pelo nome no Drive conectado. O [plano PM50 de 14/10](https://docs.google.com/document/d/1SA1tqQ-GlnHLv8tmaGZACth6NhKzvkatRgn27Nus1wY/edit) define E01–E45 e F01–F05, mas suas classificações históricas não representam o estado atual. Nenhuma etapa ausente é presumida concluída.

## Reconciliação prioritária da PR #37

- Repositório: `guilherme-freitas-oryneo/Oryneo_CRM`; `main` em `92c0a40c717bef9ddedbab2523697c32b1ae45bd` na leitura de 19/10. PR #37 aberta no head inicial `c91b231bc87a69ddb86afeeeeca5d70f3b52122a`. PR #29 aberta; #28, #30–#35 integradas; #36 encerrada sem merge.
- Workflow `39229276278`: `build` falhou com 5 testes de `StripePayment` após introdução de `record_consent`; o mock não fornecia a resposta desse novo RPC. `edge` falhou com dois `TS2345` em `stripe-webhook/index.ts` (linhas 110 e 139): `event.livemode` opcional foi passado a uma função que exige `boolean`. O build TypeScript/Vite daquela execução passou; o workflow de QA de navegador `39229276367` passou no head inicial.
- Supabase `ucikrafwfzamxvweuvgk`: `checkout-intake` v3, `billing-public` v6 e `stripe-webhook` v5 ativos. O conteúdo de todos os 18 arquivos empacotados nessas três funções corresponde exatamente ao head inicial da PR #37. A migration `20261019041910_crm_live_checkout_webhooks` consta aplicada. **A main não contém essas mudanças. Publicar as funções da main apagaria o suporte LIVE já implantado.**
- Correção na branch da PR: testes do pagamento agora distinguem a gravação do aceite da leitura posterior do pedido; o webhook deriva um booleano do ambiente selecionado pela assinatura verificada; o teste de segregação do webhook foi incluído no CI. Nenhum deploy/rollback foi executado neste checkpoint.
- A primeira rodada de CI no SHA `1f3547304e7eba728d07a89011c1cc81a8eb31c8` aprovou `build`, mas encontrou mais dois erros `TS2339` em `billing-public` ao tipar a resposta JSON da RPC de aceite. O commit `6f0fcc7` tipou e validou essa resposta; o CI posterior passou.
- **Fechamento da PR #37:** SHA final `7c3046db7c142c92e8ea6c674b605c27f118406d` com `build`, `edge` e `browser-qa` aprovados; merge em `main` `59552bf6ebeb8538916d5d928a8349d157cca8cb` às 09:50 UTC. Deploy Pages `39233099314` passou; `gh-pages` em `ff1dfdb`, cujo commit aponta para esse SHA da main. `/pagar/` e `/contratar/` responderam HTTP 200. Nenhuma Edge Function foi substituída no merge; o código publicado continua funcionalmente anterior apenas às correções de tipagem/derivação de booleano.
- Smoke público pós-merge `39233353650` passou em Chromium e WebKit: CRM/login e landing responderam 200, cotação Growth mensal + LP `337970` centavos, CNPJ presente e preflight CORS da Edge em 204. O smoke não enviou lead nem fez pagamento.
- **PR #29:** branch antiga atualizada por merge da main, preservando segregação test/LIVE. Head `6a30e08` em verificação. O fluxo agenda E13 antes de tentar renovação trimestral, mantendo claim idempotente; sem deploy ou envio real neste checkpoint.
- Verificação local da correção: `npm run build` passou, `npm run test -- --run` passou com 29 arquivos e 183 testes, `deno check --node-modules-dir=auto supabase/functions/stripe-webhook/index.ts` passou e `deno test supabase/functions/tests/webhook_environment_test.ts` passou. A primeira suíte local sofreu interferência por execução simultânea de Deno em `node_modules`; após `npm ci` e execução isolada, passou integralmente. Aguardar CI remoto no novo SHA antes de integrar.

## Estado operacional observado

- Stripe sandbox e LIVE: 6 produtos ativos e 12 preços ativos em cada conta. LIVE: webhook `we_1US83ZCY6VeI5KIZOqQtKjRT` habilitado para 8 eventos, 0 Checkout Sessions e 0 assinaturas na listagem. Vault contém `oryneo_stripe_test_webhook` e `oryneo_stripe_live_webhook`; somente nomes foram consultados.
- Supabase: 2 pedidos `test`, ambos `expired`; 0 pedidos LIVE; 2 eventos Stripe registrados, 0 LIVE. Isto não comprova pagamentos E2E. `crm_billing_environment`, `crm_direct_checkout_sandbox` e `crm_live_checkout_webhooks` constam entre as migrations.
- E16: `crm_intake_requests` contém 1 `pending` e 11 `suppressed`; `crm_mail_outbox` contém 7 mensagens `user/sent` e nenhuma `system`. Apenas `crm-mail-sync-every-minute` está ativo no cron. `crm-intake-confirmation-every-minute` segue inativo, preservando os históricos e evitando disparo externo sem homologação.
- A consulta pública de pagamento conserva estado financeiro no banco e exibe `processing` enquanto aguarda webhook autenticado. Os testes verificam que o navegador não confirma pagamento por conta própria.

## GO/NO-GO e próximo passo

| Jornada | Estado | Evidência pendente |
| --- | --- | --- |
| Código da PR #37 | Integrado | Publicação Pages confirmada; E2E financeiro permanece pendente |
| Checkout sandbox | Restrito à homologação | Transações controladas para cartão, Pix, boleto, falhas e retries |
| Checkout LIVE irrestrito | **NO-GO** | Sem transação LIVE autorizada/homologada; validar meios de pagamento, webhooks, invoice, renovação e E13 |
| E16 automático | **NO-GO** | Renderização controlada em Apple Mail, Gmail e Outlook; só então avaliar ativação do cron, sem retroatividade |
| E01–E45 e jornada comercial completa | Não aferido | Recuperar ZIP/matriz/runbook e confrontar fluxos e templates aprovados |

Próximo passo exato: validar CI da PR #29 e smoke público pós-merge; depois decidir implantação segura do webhook corrigido, sem pagamento/envio de teste não autorizado. Manter checkout LIVE e cron E16 fechados até os gates acima. Gaps em `docs/auditoria/interacoes-v2-20261019.md`; matriz individual em `docs/auditoria/matriz-e01-e45-20261019.md`.

**Percentual:** o plano PM50 fornece denominador de 50 entregas (45 modelos + F01–F05), mas nenhuma das 50 possui neste checkpoint evidência completa de aceite E2E pelos gates do próprio plano. Assim, o fechamento estritamente comprovado é **0/50 = 0%**; isso mede homologação integral, não volume de código, design ou implantação parcial. Os ~65% externos não são recalculáveis como progresso de implementação sem a escala e os critérios originais do ZIP.
