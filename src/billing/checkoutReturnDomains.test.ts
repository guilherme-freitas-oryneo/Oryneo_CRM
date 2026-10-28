import {describe,expect,it} from 'vitest';
import {buildAssistedPixOrderForm,buildCardSubscriptionCheckoutForm,buildOneTimeBoletoCheckoutForm,trustedPaymentReturnUrl} from '../../supabase/functions/_shared/billing/assisted-checkout';

const base={
 orderId:'123e4567-e89b-42d3-a456-426614174000',
 environment:'test' as const,customerEmail:'qa@example.com',
 integrationIdentifier:'oryneo_abcdefgh',
 returnUrl:'https://crm.oryneo.com.br/pagar/?token='+'A'.repeat(43)+'&retorno=1',
};
const legacy='https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/pagar/?token='+'A'.repeat(43);

describe('pagamentos — validar novos e antigos retornos com host exato',()=>{
 it('cartão, Pix e boleto aceitam o destino oficial sem alterar suas modalidades',()=>{
  const card=buildCardSubscriptionCheckoutForm({...base,funding:'credit',priceIds:['price_plan123']});
  const pix=buildAssistedPixOrderForm({...base,amountCents:173980,description:'Contratação ORYNEO Start'});
  const boleto=buildOneTimeBoletoCheckoutForm({...base,amountCents:173980,description:'Contratação ORYNEO Start'});
  expect(card.get('return_url')).toBe(base.returnUrl);
  expect(card.get('mode')).toBe('subscription');
  expect(card.get('allowed_payment_method_types[0]')).toBe('card');
  expect(pix.get('return_url')).toBe(base.returnUrl);
  expect(pix.get('mode')).toBe('payment');
  expect(pix.get('allowed_payment_method_types[0]')).toBe('pix');
  expect(boleto.get('return_url')).toBe(base.returnUrl);
  expect(boleto.get('mode')).toBe('payment');
  expect(boleto.get('allowed_payment_method_types[0]')).toBe('boleto');
 });
 it('preserva URLs do GitHub Pages já emitidas',()=>{
  expect(buildCardSubscriptionCheckoutForm({...base,returnUrl:legacy,funding:'debit',priceIds:['price_plan123']}).get('return_url')).toBe(legacy);
  expect(buildAssistedPixOrderForm({...base,returnUrl:legacy,amountCents:173980,description:'Contratação ORYNEO Start'}).get('return_url')).toBe(legacy);
  expect(trustedPaymentReturnUrl(new URL(legacy))).toBe(true);
 });
 it('bloqueia hosts semelhantes, caminhos inesperados, HTTP e URLs com credenciais',()=>{
  for(const url of [
   'https://crm.oryneo.com.br.evil.example/pagar/',
   'https://crm.oryneo.com.br/administracao/',
   'http://crm.oryneo.com.br/pagar/',
   'https://user:pass@crm.oryneo.com.br/pagar/',
   'https://attacker.example/Oryneo_CRM/pagar/',
  ]){
   expect(trustedPaymentReturnUrl(new URL(url)),url).toBe(false);
   expect(()=>buildAssistedPixOrderForm({...base,returnUrl:url,amountCents:173980,description:'Contratação ORYNEO Start'})).toThrow('INVALID_RETURN_URL');
  }
 });
});
