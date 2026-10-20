# Financeiro ORYNEO: homologação sem branch adicional (20/10/2026)

## Decisão do responsável
Não criar Supabase Branch com preço informado de US$ 0,01344/h. Preservar Stripe LIVE, Supabase de produção e CRM comercial existente. Recursos e operações do projeto atual continuam sujeitos a suas cotas normais.

## Stripe TEST — verificação de API concluída
- Conta TEST: `acct_1UQ90aCi4hhgz3b9`.
- Configuração `pmc_1UQ93RCi4hhgz3b9X4KsI2w8`: cartão, Pix, boleto: `available: true` e preferência `on`.
- Duas sessões criadas e lidas novamente com API TEST, `mode: payment`, BRL, total simulado R$ 10,00, `status: open`, `payment_status: unpaid` e `livemode: false`.
- Pix: `cs_test_a1tNdRojAwNtOdoX8COowTHM3Wqmf4Dlhk7ccom4U6J2mMN3ETpMlyiYdt`; método retornado: `pix`.
- Boleto: `cs_test_a1P5Xhu95QZ33ocXAztfvl6asu4rIoqREgJ5jLVavk3tgiTNrFLVzSAKEj`; método retornado: `boleto`.
- Nenhum boleto liquidado nem QR Pix pago. Sessão criada NÃO prova assinatura recorrente boleto nem webhook E2E.

## Risco confirmado — isolamento Supabase
A função `public.crm_create_direct_checkout` escreve em `public.crm_records` (deal), `crm_intake_requests`, `crm_billing_orders` e `crm_events` mesmo com `p_environment='test'`. `crm_records` e `crm_billing_orders` têm gatilhos de automação/onboarding. Portanto o endpoint experimental `checkout-intake-noncard-test` presente na PR #46 **NÃO deve ser implantado diretamente neste projeto** antes de substituir sua persistência por armazenamento QA isolado e demonstrar que não provoca automações comerciais/e-mails/provisionamento.

## Plano aprovado sem branch paga
1. Testar apenas Stripe TEST e consultas read-only enquanto se prepara isolamento lógico no banco já existente.
2. Implementar estrutura QA exclusiva e Edge Function de QA autenticada, sem criar `crm_records` ou eventos de automação LIVE.
3. Isolar recepção de eventos Stripe TEST e garantir identidade/idempotência, sem reconfigurar o endpoint LIVE.
4. Executar roteiro de pagamentos teste, webhook, duplicação, falha, boleto de assinatura e renovação; confirmar estados com auditoria.
5. Publicar produção seletivamente apenas com suite verde, smoke E2E e rollback verificado.

**Estado:** Stripe TEST aceitou Pix e boleto em Checkout `payment`; integração Supabase completa NÃO homologada. Sem branch adicional, sem migração aplicada, sem deploy, sem pagamentos reais.
