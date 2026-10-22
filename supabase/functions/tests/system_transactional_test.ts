import {assert,assertEquals,assertMatch} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {deterministicMailUuid} from '../_shared/mail/system-transactional.ts';
import {renderTransactionalEmail} from '../_shared/mail/transactional-templates.ts';

Deno.test('IDs de e-mail financeiro são UUID determinísticos por fatura e modelo',async()=>{
 const first=await deterministicMailUuid('stripe:in_123:renewal_failed');
 assertEquals(first,await deterministicMailUuid('stripe:in_123:renewal_failed'));
 assert(first!==await deterministicMailUuid('stripe:in_123:renewal_paid'));
 assertMatch(first,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
Deno.test('link de cobrança reutiliza o modelo transacional existente e só inclui URL segura',()=>{
 const email=renderTransactionalEmail('payment_link',{firstName:'Ana',company:'Empresa',email:'ana@example.com',orderReference:'PED-123',amountCents:12500,actionUrl:'https://checkout.stripe.com/c/pay/cs_test_123'});
 assertEquals(email.subject,'Seu link seguro de pagamento · PED-123');
 assert(email.html.includes('https://checkout.stripe.com/c/pay/cs_test_123'));
 assert(email.text.includes('R$ 125,00')||email.text.includes('R$ 125,00'));
 const unsafe=renderTransactionalEmail('payment_link',{firstName:'Ana',company:'Empresa',email:'ana@example.com',actionUrl:'javascript:alert(1)'});
 assert(!unsafe.html.includes('javascript:'));
});
