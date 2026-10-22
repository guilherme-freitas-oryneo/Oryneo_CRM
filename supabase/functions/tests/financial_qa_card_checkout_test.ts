import {assertEquals,assertThrows} from 'jsr:@std/assert';
import {buildFinancialQaCardCheckoutForm} from '../_shared/billing/financial-qa-checkout.ts';

const selection={plan:'Start',cycle:'monthly' as const,amountTotal:173980,trafficRenewalPriceId:null,
 items:[
  {key:'plan',label:'Plano Start',amountCents:74990,stripePriceId:'price_monthly',recurring:true},
  {key:'setup',label:'Implantação',amountCents:98990,stripePriceId:'price_setup',recurring:false},
 ]};

Deno.test('QA card session uses the server quote, isolates TEST metadata, and enforces credit/debit choice',()=>{
 const credit=buildFinancialQaCardCheckoutForm({orderId:'00000000-0000-4000-8000-000000000001',selection,funding:'credit'});
 assertEquals(credit.get('mode'),'subscription');
 assertEquals(credit.get('ui_mode'),'elements');
 assertEquals(credit.get('line_items[0][price]'),'price_monthly');
 assertEquals(credit.get('add_invoice_items[0][price]'),'price_setup');
 assertEquals(credit.get('metadata[oryneo_qa_isolated]'),'true');
 assertEquals(credit.get('subscription_data[metadata][oryneo_order_id]'),'00000000-0000-4000-8000-000000000001');
 assertEquals(credit.get('payment_method_options[card][restrictions][funding_types_blocked][0]'),'debit');
 assertEquals(credit.get('payment_method_options[card][restrictions][funding_types_blocked][1]'),'prepaid');
 const debit=buildFinancialQaCardCheckoutForm({orderId:'00000000-0000-4000-8000-000000000001',selection,funding:'debit'});
 assertEquals(debit.get('payment_method_options[card][restrictions][funding_types_blocked][0]'),'credit');
 assertEquals(debit.get('payment_method_options[card][restrictions][funding_types_blocked][1]'),'prepaid');
});

Deno.test('QA card builder rejects LIVE, unknown funding, client-price mismatches, and unsupported traffic',()=>{
 const input={orderId:'00000000-0000-4000-8000-000000000001',selection,funding:'credit' as const};
 assertThrows(()=>buildFinancialQaCardCheckoutForm({...input,environment:'live' as never}),Error,'QA_TEST_ONLY');
 assertThrows(()=>buildFinancialQaCardCheckoutForm({...input,funding:'cash' as never}),Error,'INVALID_CARD_FUNDING');
 assertThrows(()=>buildFinancialQaCardCheckoutForm({...input,selection:{...selection,amountTotal:10}}),Error,'TOTAL_MISMATCH');
 assertThrows(()=>buildFinancialQaCardCheckoutForm({...input,selection:{...selection,trafficRenewalPriceId:'price_traffic'}}),Error,'QA_TRAFFIC_NOT_READY');
});

