import {assertEquals,assertThrows} from 'jsr:@std/assert';
import {buildBoletoSubscriptionForm,buildPixCheckoutForm,type ServerBillingSelection,type PaymentOrderContext} from '../_shared/billing/stripe-payment-forms.ts';
const selection:ServerBillingSelection={
 plan:'Growth',cycle:'monthly',amountTotal:248980,trafficRenewalPriceId:null,
 items:[
  {key:'growth_monthly',label:'Plano Growth',amountCents:109990,stripePriceId:'price_recurring',recurring:true},
  {key:'growth_setup',label:'Implantação',amountCents:138990,stripePriceId:'price_setup',recurring:false},
 ],
};
const context:PaymentOrderContext={
 orderId:'11111111-1111-4111-8111-111111111111',environment:'test',
 customerEmail:'teste@example.com',customerName:'Cliente Teste',
 returnUrl:'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/pagar/?token=test',
};
Deno.test('boleto subscription includes recurring plan and setup exactly once',()=>{
 const f=buildBoletoSubscriptionForm(selection,context,'cus_1234567890');
 assertEquals(f.get('collection_method'),'send_invoice');
 assertEquals(f.get('days_until_due'),'3');
 assertEquals(f.get('payment_settings[payment_method_types][0]'),'boleto');
 assertEquals(f.get('items[0][price]'),'price_recurring');
 assertEquals(f.get('add_invoice_items[0][price]'),'price_setup');
 assertEquals(f.get('items[1][price]'),null);
 assertEquals(f.get('add_invoice_items[1][price]'),null);
 assertEquals(f.get('metadata[oryneo_billing_environment]'),'test');
});
Deno.test('Pix checkout charges exact initial total and never creates subscription',()=>{
 const f=buildPixCheckoutForm(selection,context);
 assertEquals(f.get('mode'),'payment');
 assertEquals(f.get('payment_method_types[0]'),'pix');
 assertEquals(f.get('line_items[0][price_data][unit_amount]'),'248980');
 assertEquals(f.get('subscription_data[metadata][oryneo_order_id]'),null);
 assertEquals(f.get('customer_creation'),'always');
});
Deno.test('rejects client-supplied mismatched totals and unverified prices',()=>{
 assertThrows(()=>buildPixCheckoutForm({...selection,amountTotal:1},context),Error,'TOTAL_MISMATCH');
 assertThrows(()=>buildPixCheckoutForm({...selection,items:[{...selection.items[0],stripePriceId:'invalid'},selection.items[1]]},context),Error,'INVALID_SERVER_PRICE');
});
Deno.test('traffic renewal is blocked until separate invoice renewal is implemented',()=>{
 const traffic={...selection,trafficRenewalPriceId:'price_traffic'};
 assertThrows(()=>buildBoletoSubscriptionForm(traffic,context,'cus_1234567890'),Error,'NONCARD_TRAFFIC_RENEWAL_NOT_READY');
 assertThrows(()=>buildPixCheckoutForm(traffic,context),Error,'NONCARD_TRAFFIC_RENEWAL_NOT_READY');
});
Deno.test('invalid customer and untrusted return URLs rejected',()=>{
 assertThrows(()=>buildBoletoSubscriptionForm(selection,context,'not_a_customer'),Error,'INVALID_STRIPE_CUSTOMER');
 assertThrows(()=>buildPixCheckoutForm(selection,{...context,returnUrl:'https://attacker.example/'}),Error,'INVALID_RETURN_URL');
});
