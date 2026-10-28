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

**Estado atualizado:** Stripe TEST aceitou Pix e boleto em Checkout `payment` e a criação de uma assinatura recorrente boleto com implantação única. O sandbox QA no Supabase existente está implantado, mas a jornada autenticada de pagamento + webhook E2E ainda NÃO está homologada. Sem branch paga, sem pagamentos LIVE.

## Implantação isolada efetivamente realizada no Supabase existente
- Migrations aplicadas: `oryneo_financial_qa_isolation` e `oryneo_financial_qa_pix_identity_enforcement`.
- Schema privado `oryneo_financial_qa`: `orders` e `events`, RLS ligado, zero gatilhos, sem relacionamentos com CRM comercial.
- RPCs `oryneo_qa_billing_*` restritas a `service_role`. Confirmado: `anon` e `authenticated` sem permissão de execução.
- Nova Edge Function `checkout-intake-noncard-test`, v1, `verify_jwt=true`, membro CRM autenticado e isolamento por proprietário. Usa apenas `getBillingEnvironmentConfig('test')` e e-mail fictício `qa@example.com`.
- Testes SQL dentro de transações revertidas: Pix e boleto, criação idempotente, link de fornecedor, boleto pendente, liquidação simulada, duplicidade, valores inválidos, eventos fora de ordem e rejeição de Checkout Pix sem ID; nenhum registro de QA preservado.
- Snapshot após testes: `qa_orders=0`, `qa_events=0`, `live_orders=0`.
- As funções existentes `checkout-intake` v5, `billing-create-order` v9, `billing-public` v6, `stripe-webhook` v6 não foram substituídas. Stripe LIVE não foi alterada.
- CI estático bloqueia qualquer referência direta do endpoint QA às tabelas comerciais ou à chave Stripe LIVE.

## Compatibilidade de assinatura boleto comprovada na Stripe TEST
- Cliente fictício TEST `cus_VTbYLvq5OZO8dT`, `qa@example.com`.
- Assinatura TEST `sub_1USeLtCi4hhgz3b9KL9u5Xnu` criada com `collection_method=send_invoice`, boleto e vencimento de 3 dias.
- Mensalidade Start (recorrente) R$ 749,90 + implantação (uma vez) R$ 989,90; primeira fatura `in_1USeLtCi4hhgz3b9UEld2Hek`, total **R$ 1.739,80**, BRL, status `draft`, não paga.
- A assinatura foi **cancelada em Stripe TEST** (`status=canceled`) após comprovar o contrato. Nenhum valor real cobrado ou boleto liquidado.

## Limites ainda existentes
1. O backend QA está pronto para requests autenticados, porém não foi executado um POST autenticado pelo frontend contra ele; a criação Stripe TEST acima foi direta via API.
2. A conciliação TEST é por consulta autenticada ao provedor (polling). O webhook atual recebe eventos de teste e permanece intocado; a segregação completa de eventos TEST por webhook ainda precisa ser validada antes de realizar pagamento teste E2E.
3. Ainda faltam tela QA com PaymentElement Pix, fatura boleto disponível, renovação trimestral de tráfego, disparos transacionais efetivos, cenários de falha/expiração e formalização final.
4. A migration original de conciliação de fatura no CRM ficou somente na PR; **não foi aplicada** e não deve ser confundida com o schema QA.
