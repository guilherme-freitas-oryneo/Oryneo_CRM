import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14';
import { nextPlanChargeAt, nextTrafficChargeAt, resolveRenewalCharge } from '../_shared/billing/billing-center-policy.ts';
import { applyCardFundingRestriction, buildAssistedCheckoutForm, buildCardSubscriptionCheckoutForm, buildOneTimeBoletoCheckoutForm } from '../_shared/billing/assisted-checkout.ts';

Deno.test('billing center derives only recurring catalogue charges', () => {
  assertEquals(resolveRenewalCharge({ plan: 'Growth', cycle: 'monthly', addons: ['landing-page'] }, 'plan'), {
    kind: 'plan_monthly', amountCents: 109_990, label: 'Plano Growth · renovação mensal',
  });
  assertEquals(resolveRenewalCharge({ plan: 'Scale', cycle: 'annual', addons: ['traffic'] }, 'traffic'), {
    kind: 'traffic_quarterly', amountCents: 296_970, label: 'Gestão de tráfego pago · renovação trimestral',
  });
  assertThrows(() => resolveRenewalCharge({ plan: 'Start', cycle: 'monthly', addons: [] }, 'traffic'), Error, 'TRAFFIC_NOT_CONTRACTED');
});

Deno.test('billing periods calculate next month, year, and traffic quarter in UTC', () => {
  assertEquals(nextPlanChargeAt('2026-01-15T12:00:00.000Z', 'monthly'), '2026-02-15T12:00:00.000Z');
  assertEquals(nextPlanChargeAt('2026-01-15T12:00:00.000Z', 'annual'), '2027-01-15T12:00:00.000Z');
  assertEquals(nextTrafficChargeAt('2026-01-15T12:00:00.000Z'), '2026-04-15T12:00:00.000Z');
  assertEquals(nextPlanChargeAt('2026-01-31T12:00:00.000Z', 'monthly'), '2026-02-28T12:00:00.000Z');
  assertEquals(nextTrafficChargeAt('2026-11-30T12:00:00.000Z'), '2027-02-28T12:00:00.000Z');
  assertEquals(nextTrafficChargeAt('not-a-date'), null);
});

Deno.test('assisted renewal checkout is one-time, single-method, and server-priced', () => {
  const form=buildAssistedCheckoutForm({
    obligationId:'11111111-1111-4111-8111-111111111111',orderId:'22222222-2222-4222-8222-222222222222',
    environment:'test',method:'pix_assisted',customerEmail:'qa@oryneo.com.br',amountCents:109_990,
    label:'Plano Growth · renovação mensal',competenceKey:'2026-11',
  });
  assertEquals(form.get('mode'),'payment');
  assertEquals(form.get('payment_method_types[0]'),'pix');
  assertEquals(form.get('line_items[0][price_data][unit_amount]'),'109990');
  assertEquals(form.get('metadata[oryneo_billing_environment]'),'test');
  assertEquals(form.get('metadata[oryneo_obligation_id]'),'11111111-1111-4111-8111-111111111111');
  assertThrows(()=>buildAssistedCheckoutForm({
    obligationId:'11111111-1111-4111-8111-111111111111',orderId:'22222222-2222-4222-8222-222222222222',
    environment:'test',method:'boleto_assisted',customerEmail:'bad',amountCents:0,label:'Boleto',competenceKey:'2026-11',
  }),Error,'INVALID_CHARGE');
});

Deno.test('credit and debit choices block the opposite Stripe card funding types server-side',()=>{
  const credit=new URLSearchParams();applyCardFundingRestriction(credit,'credit');
  assertEquals(credit.get('payment_method_options[card][restrictions][funding_types_blocked][0]'),'debit');
  assertEquals(credit.get('payment_method_options[card][restrictions][funding_types_blocked][1]'),'prepaid');
  const debit=new URLSearchParams();applyCardFundingRestriction(debit,'debit');
  assertEquals(debit.get('payment_method_options[card][restrictions][funding_types_blocked][0]'),'credit');
  assertEquals(debit.get('payment_method_options[card][restrictions][funding_types_blocked][1]'),'prepaid');
});

Deno.test('card subscription Checkout Session binds a funding choice to server prices',()=>{
  const form=buildCardSubscriptionCheckoutForm({orderId:'11111111-1111-4111-8111-111111111111',environment:'test',customerEmail:'qa@oryneo.com.br',funding:'debit',priceIds:['price_abc123'],returnUrl:'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/pagar/?token=abc',integrationIdentifier:'oryneo_test'});
  assertEquals(form.get('mode'),'subscription');
  assertEquals(form.get('metadata[oryneo_card_funding]'),'debit');
  assertEquals(form.get('payment_method_options[card][restrictions][funding_types_blocked][0]'),'credit');
  assertEquals(form.get('line_items[0][price]'),'price_abc123');
});

Deno.test('one-time boleto Checkout Session uses the stored total and never creates a subscription',()=>{
  const form=buildOneTimeBoletoCheckoutForm({orderId:'11111111-1111-4111-8111-111111111111',environment:'test',customerEmail:'qa@oryneo.com.br',amountCents:173_980,description:'Contratação ORYNEO Start',returnUrl:'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/pagar/?token=abc',integrationIdentifier:'oryneo_test'});
  assertEquals(form.get('mode'),'payment');
  assertEquals(form.get('allowed_payment_method_types[0]'),'boleto');
  assertEquals(form.get('line_items[0][price_data][unit_amount]'),'173980');
  assertEquals(form.get('customer_creation'),'always');
  assertEquals(form.has('subscription_data[billing_mode][type]'),false);
});
