import { describe, expect, it } from 'vitest';
import { buildAssistedPixOrderForm } from '../../supabase/functions/_shared/billing/assisted-checkout';

const valid={
 orderId:'123e4567-e89b-42d3-a456-426614174000',
 environment:'test' as const,
 customerEmail:'cliente@example.com',
 amountCents:327980,
 description:'Contratação ORYNEO Growth',
 returnUrl:'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/pagar/?token=valid-token&retorno=1',
 integrationIdentifier:'oryneo_abcdefgh',
};

describe('Pix assistido: formulário seguro de sessão Stripe',()=>{
 it('usa pagamento único em BRL, valor calculado no servidor e metadados de conciliação',()=>{
  const form=buildAssistedPixOrderForm(valid);
  expect(form.get('mode')).toBe('payment');
  expect(form.get('ui_mode')).toBe('elements');
  expect(form.get('allowed_payment_method_types[0]')).toBe('pix');
  expect(form.get('line_items[0][price_data][unit_amount]')).toBe('327980');
  expect(form.get('line_items[0][price_data][currency]')).toBe('brl');
  expect(form.get('metadata[oryneo_order_id]')).toBe(valid.orderId);
  expect(form.get('payment_intent_data[metadata][oryneo_order_id]')).toBe(valid.orderId);
  expect(form.has('subscription_data[billing_mode][type]')).toBe(false);
 });
 it('rejeita valor inválido e retorno fora do domínio autorizado',()=>{
  expect(()=>buildAssistedPixOrderForm({...valid,amountCents:0})).toThrow('INVALID_PIX_AMOUNT');
  expect(()=>buildAssistedPixOrderForm({...valid,returnUrl:'https://example.com/Oryneo_CRM/pagar/'})).toThrow('INVALID_RETURN_URL');
 });
});
