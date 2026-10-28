import {assertEquals,assertMatch,assertThrows} from 'jsr:@std/assert';
import {billingNotice} from '../_shared/billing/billing-notices.ts';
const base={customerName:'Marina Silva',reference:'ORY-TEST-123',amountCents:173980};
Deno.test('boleto issued is never described as paid',()=>{
 const notice=billingNotice({...base,kind:'boleto_issued',invoiceUrl:'https://invoice.stripe.com/i/test'});
 assertMatch(notice.text,/ainda não consta como pago/i);
 assertMatch(notice.html,/Consultar fatura segura/);
 assertEquals(notice.subject,'Seu boleto ORYNEO está disponível');
});
Deno.test('failed and paid notices are distinct',()=>{
 assertMatch(billingNotice({...base,kind:'payment_failed'}).text,/não foi confirmado/i);
 assertMatch(billingNotice({...base,kind:'payment_confirmed'}).text,/foi confirmado/i);
});
Deno.test('untrusted invoice URLs and unsafe reference markup are rejected or escaped',()=>{
 assertThrows(()=>billingNotice({...base,kind:'boleto_issued',invoiceUrl:'https://evil.example/'}),Error,'UNTRUSTED_INVOICE_LINK');
 const notice=billingNotice({...base,kind:'payment_failed',reference:'ORY-&-REF'});
 assertEquals(notice.html.includes('ORY-&amp;-REF'),true);
});
