# ORYNEO Stripe Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar cobrança Stripe em modo de teste, iniciada no CRM e concluída em uma página pública responsiva com identidade ORYNEO.

**Architecture:** O CRM autenticado cria pedidos a partir da proposta já registrada; Supabase Edge Functions recalculam valores e criam Checkout Sessions; a página `/pagar/` recebe apenas um token opaco e monta o Payment Element; webhooks assinados são a única fonte de confirmação financeira.

**Tech Stack:** React 19, Vite, TypeScript, Supabase/Postgres/Edge Functions, Stripe Checkout Sessions + Payment Element.

**Spec:** `docs/superpowers/specs/2026-10-13-stripe-billing-design.md`

## Global Constraints

- Operar somente em Stripe test mode nesta fase.
- Nunca expor `STRIPE_SECRET_KEY`, service role ou webhook secret no cliente ou GitHub.
- Recalcular valores no servidor em centavos; não confiar em totais do navegador.
- A página pública revela somente o pedido delimitado por token opaco e expirável.
- Não habilitar Stripe Tax nem apresentar invoice Stripe como NFS-e.

## Review Focus

- Token ausente, inválido ou expirado deve produzir estado seguro e compreensível.
- Repetições não podem duplicar pedido, sessão ou processamento de webhook.
- Plano anual, implantação e tráfego trimestral devem manter suas recorrências distintas.
- Pagamento recusado ou assíncrono não pode marcar o pedido como pago.
- Tela precisa continuar utilizável em 320 px e com navegação por teclado.

---

### Task 1: Página pública de cobrança

**Files:**
- Create: `src/billing/PaymentPage.tsx`
- Create: `src/billing/payment.css`
- Create: `src/billing/PaymentPage.test.tsx`
- Create: `pagar/index.html`
- Modify: `vite.config.ts`

- [ ] Escrever testes de resumo, recorrência, aceite e estados de erro.
- [ ] Confirmar falha dos testes pela ausência do componente.
- [ ] Implementar a página responsiva inspirada no protótipo MagicPath.
- [ ] Executar teste específico e suíte completa.

### Task 2: Catálogo e pedidos confiáveis

**Files:**
- Create: `supabase/migrations/20261013_crm_stripe_billing.sql`
- Create: `supabase/functions/_shared/billing/catalog.ts`
- Create: `supabase/functions/tests/billing_catalog_test.ts`

- [ ] Fixar catálogo canônico e testar combinações mensal/anual/add-ons.
- [ ] Criar tabelas de pedidos e eventos com RLS restritiva.
- [ ] Verificar advisors de segurança e performance.

### Task 3: Funções Stripe e webhook

**Files:**
- Create: `supabase/functions/billing-create-order/index.ts`
- Create: `supabase/functions/billing-public/index.ts`
- Create: `supabase/functions/stripe-webhook/index.ts`

- [ ] Validar membro do CRM e proposta antes de criar pedido.
- [ ] Criar sessão idempotente usando o segredo do Supabase.
- [ ] Verificar assinatura sobre corpo bruto e deduplicar eventos.
- [ ] Implantar funções com JWT apropriado a cada superfície.

### Task 4: Ação de cobrança no CRM

**Files:**
- Modify: `src/DealDetails.tsx`
- Modify: `src/details.css`
- Create: `src/billing/api.ts`
- Create: `src/billing/BillingAction.test.tsx`

- [ ] Adicionar revisão e ação “Preparar cobrança” somente para propostas válidas.
- [ ] Exibir status financeiro e permitir copiar o link público.
- [ ] Testar autorização, erros e repetição.

### Task 5: Homologação e deploy

- [ ] Rodar testes unitários, build e verificação mobile/desktop.
- [ ] Criar catálogo Stripe test mode sem duplicar objetos existentes.
- [ ] Aplicar migration e funções no projeto `Oryneo-CRM`.
- [ ] Configurar endpoint e segredo do webhook no Stripe test mode.
- [ ] Testar pagamento aprovado, recusado e reentrega de webhook.
- [ ] Publicar o frontend somente após as verificações.
