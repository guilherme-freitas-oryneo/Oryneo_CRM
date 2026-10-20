# Etapa A — evidências de homologação parcial (20/10/2026)

**Escopo:** Stripe TEST e Supabase existente, em estrutura isolada. Sem Supabase Branch paga. PR #46 continua *draft*; não ativar Pix nem boleto no checkout LIVE.

## Evidências de banco e isolamento
- Supabase `ucikrafwfzamxvweuvgk`, schema privado `oryneo_financial_qa` instalado via migrations `oryneo_financial_qa_isolation` e `oryneo_financial_qa_identity_guard`.
- Tabelas `orders` e `events` com RLS habilitado e zero triggers comerciais.
- RPCs `oryneo_qa_billing_create`, `link`, `read`, `reconcile`: anon/authenticated `EXECUTE=false`; service_role `EXECUTE=true`.
- Testes transacionais reais SQL: criação Pix e boleto, replay de request, vínculo com IDs Stripe TEST, eventos pendentes, falha, pagamento simulado, valor incompatível rejeitado, evento duplicado rejeitado, falha posterior não rebaixa pago. Cada transação terminou com `ROLLBACK`.
- Após os testes: **0 QA orders, 0 QA events, 2 pedidos CRM existentes e 13 jobs de automação**, sem novas tarefas comerciais.
- Edge Function exclusivamente QA `checkout-intake-noncard-test` implantada na versão 2 com `verify_jwt=true`; checkout original, billing-public, billing-create-order e stripe-webhook LIVE não foram substituídos.

## Evidências de Stripe TEST
- Configuração de pagamento confirma cartão, Pix e boleto `available=true`, `on`.
- Pix Checkout Elements via API: `cs_test_a1rbWAjGmlTQZv4dqKKIFZB4AuOwtPbtcL5hl0MUtxHditkdvpuTeLZrUs`; `mode=payment`, `ui_mode=elements`, `payment_method_types=[pix]`, `client_secret` presente, `unpaid`, total R$ 10,00 simulado.
- Boleto recorrente: Stripe TEST criou `sub_1USeOdCi4hhgz3b9KTQfMyIe`, `collection_method=send_invoice`, preço `oryneo_start_monthly`, mais setup único `oryneo_start_setup`.
- Fatura inicial `in_1USeOdCi4hhgz3b9ztGRSiTT` tem total R$ 1.739,80, em BRL, método `boleto`; foi finalizada em `open` e recebeu URL de fatura hospedada em `invoice.stripe.com`. **Não houve pagamento**.
- Assinatura `sub_1USeOdCi4hhgz3b9KTQfMyIe` **cancelada imediatamente** após teste para impedir renovações de QA futuras.
- Sem cobranças, cancelamentos ou alterações em Stripe LIVE.

## O que ainda NÃO foi homologado
1. Conclusão manual do checkout Pix e liquidação real de simulação até `paid`.
2. Pagamento de boleto TEST com voucher e evento assinado de liquidação; conciliação via webhook (não apenas via consulta Stripe).
3. Execução autenticada de ponta a ponta da Edge Function QA a partir de sessão CRM.
4. Compatibilidade de todo o catálogo, addons e renovação trimestral de tráfego.
5. Outbox de aviso transacional, renovação, inadimplência, cancelamento e provisionamento seguro.
6. Gate final do CI após últimas atualizações e revisão UX antes de qualquer merge.

## Proteções preservadas
- Sem branch adicional (custo horário recusado pelo usuário).
- Nenhum dado TEST vinculado às tabelas comerciais; nenhum e-mail ou onboarding comercial disparado.
- Não mesclar a PR #46 nem implantar alterações de webhook/billing em LIVE até os gates acima serem cumpridos.
