import type {ServerBillingSelection} from './stripe-payment-forms.ts';
import {applyCardFundingRestriction,type CardFundingChoice} from './assisted-checkout.ts';

const QA_RETURN_URL='https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/qa/pr-46/?qa_return=1';

function validateOrderAndSelection(orderId:string,selection:ServerBillingSelection):void{
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId))throw new Error('INVALID_ORDER_ID');
 if(selection.trafficRenewalPriceId||selection.items.some(item=>item.key==='traffic'))throw new Error('QA_TRAFFIC_NOT_READY');
 if(!Number.isSafeInteger(selection.amountTotal)||selection.amountTotal<=0||
   selection.items.reduce((sum,item)=>sum+item.amountCents,0)!==selection.amountTotal)throw new Error('TOTAL_MISMATCH');
 if(selection.items.some(item=>!/^price_[A-Za-z0-9]+$/.test(item.stripePriceId)||!Number.isSafeInteger(item.amountCents)||item.amountCents<=0))throw new Error('INVALID_SERVER_PRICES');
}

export function buildFinancialQaCardCheckoutForm(input:Readonly<{
 orderId:string;selection:ServerBillingSelection;funding:CardFundingChoice;environment?:'test'|'live';
}>):URLSearchParams{
 if(input.environment&&input.environment!=='test')throw new Error('QA_TEST_ONLY');
 validateOrderAndSelection(input.orderId,input.selection);
 if(input.funding!=='credit'&&input.funding!=='debit')throw new Error('INVALID_CARD_FUNDING');
 const selection=input.selection;
 const recurring=selection.items.filter(item=>item.recurring),oneTime=selection.items.filter(item=>!item.recurring);
 if(recurring.length!==1)throw new Error('INVALID_SERVER_PRICES');
 const form=new URLSearchParams();
 form.set('mode','subscription');form.set('ui_mode','elements');form.set('payment_method_types[0]','card');
 form.set('customer_email','qa@example.com');form.set('customer_creation','always');form.set('locale','pt-BR');
 form.set('billing_address_collection','required');form.set('return_url',QA_RETURN_URL);
 form.set('client_reference_id',input.orderId);
 for(const [name,value] of Object.entries({oryneo_qa_isolated:'true',oryneo_billing_environment:'test',oryneo_order_id:input.orderId,oryneo_payment_method:'card',oryneo_card_funding:input.funding})){
  form.set(`metadata[${name}]`,value);form.set(`subscription_data[metadata][${name}]`,value);
 }
 form.set('subscription_data[billing_mode][type]','flexible');
 form.set('line_items[0][price]',recurring[0].stripePriceId);form.set('line_items[0][quantity]','1');
 oneTime.forEach((item,index)=>{form.set(`add_invoice_items[${index}][price]`,item.stripePriceId);form.set(`add_invoice_items[${index}][quantity]`,'1')});
 applyCardFundingRestriction(form,input.funding);
 return form;
}
