# ORYNEO — Rodada A | Homologação financeira (20/10/2026)

**Estado:** implementação em PR #46, sem merge ou deploy. Não declarar homologado.

## Evidências verificadas
- Catálogo: 12 preços encontrados em Stripe TEST e LIVE, em BRL, com valores e intervalos compatíveis com `catalog.ts`.
- Stripe TEST: cartão habilitado; boleto e Pix **indisponíveis/desligados** na configuração de métodos consultada.
- Stripe LIVE: cartão, boleto e Pix habilitados na configuração consultada. Isso não comprova compatibilidade de integração.
- Webhooks TEST e LIVE: endpoints ativos com `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
- Banco: apenas dois pedidos TEST expirados no momento da auditoria; zero assinaturas ou faturas vinculadas. Nenhuma compra LIVE comprovada.
- PR #46 contém código de sandbox, builders de boleto/Pix, validação de links de fatura, migration inicial e testes.
- A migration **não foi aplicada**. As Edge Functions alteradas **não foram implantadas**.
- GitHub PR head `27307cec`: CI de código e QA navegador aprovados; `main` permanece `173b4425`.

## Matriz das 20 microtarefas
| # | Microtarefa | Situação nesta rodada |
|---|---|---|
| 01 | Auditar PR e CI | Auditada; CI ampliado para testar o código novo |
| 02 | Conferir preços e ciclos | Conferido em TEST e LIVE |
| 03 | Auditar tabelas e RPCs | Conferido; identificada ausência de conciliação inicial por invoice |
| 04 | Verificar compatibilidade de meios | Conferido; TEST não habilita Pix/boleto |
| 05 | Emissão recorrente de boleto | Implementação de sandbox versionada; integração real bloqueada |
| 06 | Vencimento e ciclos | `send_invoice` e prazo de 3 dias preparados; teste Stripe pendente |
| 07 | Conciliação de faturas | RPCs de pagamento/falha inicial e webhook versionados; migration não aplicada |
| 08 | Idempotência | Chaves Stripe, recuperação de cliente/assinatura, eventos e índices preparados |
| 09 | Provisionamento após pagamento | Regras e proteção na RPC; E2E pendente |
| 10 | Inadimplência/cancelamentos | Falha inicial preparada; renovação e cancelamento ainda exigem E2E |
| 11 | Pix avulso | Checkout TEST versionado; TEST Pix desabilitado |
| 12 | Confirmação/expiração Pix | Eventos já existentes, política de liquidação e testes adicionados; E2E pendente |
| 13 | Estados no CRM | Pedido/fatura persistentes; falta validar interface e eventos reais |
| 14 | E-mails e avisos | Templates e textos preparados; disparo real de aviso de boleto ainda não integrado |
| 15 | Checkout visual | Tela de boleto por fatura Stripe preparada; seleção pública não liberada |
| 16 | Testes automatizados | CI ampliado; TypeScript, Deno e frontend aprovados no commit 27307cec |
| 17 | Stripe TEST integrado | Bloqueado pelos métodos TEST desligados e migration não homologada |
| 18 | Regressão e CI | CI e QA navegador aprovados no commit 27307cec; houve falha intermitente anterior no WebKit mobile, com reexecução verde |
| 19 | Publicação seletiva | **Não realizada**: pré-requisitos ainda não cumpridos |
| 20 | Jornada E2E | **Não homologada** |

## Portões de segurança para publicação
1. Habilitar Pix e boleto **na conta Stripe TEST**, sem alterar LIVE. Confirmar que boleto pode gerar link hospedado e que os e-mails Stripe para pagamentos que exigem confirmação estão configurados.
2. Disponibilizar banco de homologação isolado, sem efeitos colaterais em clientes, cron ou CRM LIVE. Supabase branching pode gerar cobrança adicional; obter consentimento de custo antes de criá-lo.
3. Aplicar a migration somente no banco isolado e testar funções de liquidação/falha, assinatura, idempotência, eventos duplicados e fora de ordem.
4. Implantar `checkout-intake-noncard-test`, `billing-public` e `stripe-webhook` somente em ambiente de homologação e executar compras TEST controladas.
5. Verificar que fatura emitida, boleto aberto e Checkout Pix concluído com pagamento pendente **não liberam acesso**. Confirmar liquidação antes de criar boas-vindas/implantação.
6. Completar renovação de tráfego para boleto/Pix, mensagens transacionais com outbox e idempotência e gestão de assinatura sem cartão.
7. Validar aceite jurídico vigente, jornada de cancelamento, revisão visual e smoke tests. Só então planejar LIVE, com rollback e monitoramento.

## Rollback
- Como esta PR ainda não foi mesclada, nenhuma reversão de produção é necessária.
- Se a homologação futura falhar, manter os métodos não-cartão bloqueados e restaurar somente as funções modificadas; não desfazer faturas legítimas nem excluir registros financeiros.
- O webhook LIVE atual e a cobrança por cartão devem permanecer preservados até conclusão dos testes.

## Fontes operacionais
- Stripe Boleto com assinaturas: https://docs.stripe.com/payments/boleto/set-up-subscription
- Stripe Boleto Checkout e confirmação assíncrona: https://docs.stripe.com/payments/boleto/accept-a-payment?payment-ui=checkout
- Stripe Pix: https://docs.stripe.com/payments/pix
