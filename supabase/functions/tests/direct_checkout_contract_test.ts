import assert from 'node:assert/strict';
import { parseDirectCheckoutInput } from '../_shared/billing/direct-checkout.ts';

const input = { request_id: '11111111-1111-4111-8111-111111111111', payment_token: 'A'.repeat(43), customer_name: 'Marina Costa', customer_email: 'MARINA@ACME.EXAMPLE ', company: 'Acme Comércio', tax_id: '52998224725', plan: 'Growth', cycle: 'annual', addons: ['landing-page', 'traffic'] };
Deno.test('checkout direto normaliza o mínimo necessário e ignora qualquer preço vindo do navegador', () => {
  const parsed = parseDirectCheckoutInput({ ...input, payment_method:'pix', amount_total: 1, price_id: 'price_unsafe' });
  assert.equal(parsed.customer_email, 'marina@acme.example');
  assert.deepEqual(parsed.addons, ['landing-page', 'traffic']);
});
Deno.test('checkout direto recusa token, identidade ou seleção inválidos antes de qualquer escrita', () => {
  assert.throws(() => parseDirectCheckoutInput({ ...input, payment_token: 'short' }));
  assert.throws(() => parseDirectCheckoutInput({ ...input, customer_email: 'invalido' }));
  assert.throws(() => parseDirectCheckoutInput({ ...input, addons: ['admin-access'] }));
});

Deno.test('checkout exige escolha explícita e trata crédito ou débito como subopção exclusiva do cartão',()=>{
 assert.throws(()=>parseDirectCheckoutInput(input));
 assert.throws(()=>parseDirectCheckoutInput({...input,payment_method:'card'}));
 assert.equal(parseDirectCheckoutInput({...input,payment_method:'card',card_funding:'credit'}).card_funding,'credit');
 assert.equal(parseDirectCheckoutInput({...input,payment_method:'boleto'}).card_funding,null);
 assert.equal(parseDirectCheckoutInput({...input,payment_method:'card',card_funding:'debit'}).card_funding,'debit');
 assert.throws(()=>parseDirectCheckoutInput({...input,payment_method:'card',card_funding:'cash'}));
 assert.equal(parseDirectCheckoutInput({...input,payment_method:'pix'}).card_funding,null);
 assert.throws(()=>parseDirectCheckoutInput({...input,payment_method:'bank_transfer'}));
});
