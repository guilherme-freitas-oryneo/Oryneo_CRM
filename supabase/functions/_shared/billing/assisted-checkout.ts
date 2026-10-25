import type { BillingEnvironment } from './environment.ts';
import type { AssistedPaymentMethod } from './obligations.ts';

export type AssistedCheckoutInput=Readonly<{
 obligationId:string;orderId:string;environment:BillingEnvironment;method:AssistedPaymentMethod;
 customerEmail:string;amountCents:number;label:string;competenceKey:string;
}>;

export type CardFundingChoice='credit'|'debit';

/** Checkout Session enforcement for the customer's explicit credit/debit choice. */
export function applyCardFundingRestriction(form:URLSearchParams,choice:CardFundingChoice):void{
 if(choice!=='credit'&&choice!=='debit')throw new Error('INVALID_CARD_FUNDING');
 form.set('allowed_payment_method_types[0]','card');
 const blocked=choice==='credit'?['debit','prepaid']:['credit','prepaid'];
 blocked.forEach((type,index)=>form.set(`payment_method_options[card][restrictions][funding_types_blocked][${index}]`,type));
}

export type CardSubscriptionCheckoutInput=Readonly<{
 orderId:string;environment:BillingEnvironment;customerEmail:string;funding:CardFundingChoice;
 priceIds:readonly string[];returnUrl:string;integrationIdentifier:string;trafficRenewalPriceId?:string|null;
}>;

export function buildCardSubscriptionCheckoutForm(input:CardSubscriptionCheckoutInput):URLSearchParams{
 if(!/^[0-9a-f-]{36}$/i.test(input.orderId)||!input.priceIds.length||input.priceIds.some(id=>!/^price_[A-Za-z0-9]+$/.test(id)))throw new Error('INVALID_CHECKOUT_ITEMS');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail)||!/^oryneo_[a-z]+$/.test(input.integrationIdentifier))throw new Error('INVALID_CHECKOUT_CUSTOMER');
 const returnUrl=new URL(input.returnUrl);
 if(returnUrl.protocol!=='https:'||returnUrl.hostname!=='guilherme-freitas-oryneo.github.io'||returnUrl.port||returnUrl.username||returnUrl.password||returnUrl.hash||returnUrl.pathname!=='/Oryneo_CRM/pagar/')throw new Error('INVALID_RETURN_URL');
 const form=new URLSearchParams();form.set('mode','subscription');form.set('ui_mode','elements');form.set('customer_email',input.customerEmail);form.set('integration_identifier',input.integrationIdentifier);form.set('locale','pt-BR');form.set('billing_address_collection','required');form.set('return_url',input.returnUrl);
 form.set('metadata[oryneo_order_id]',input.orderId);form.set('metadata[oryneo_billing_environment]',input.environment);form.set('metadata[oryneo_card_funding]',input.funding);
 form.set('subscription_data[metadata][oryneo_order_id]',input.orderId);form.set('subscription_data[billing_mode][type]','flexible');
 if(input.trafficRenewalPriceId){if(!/^price_[A-Za-z0-9]+$/.test(input.trafficRenewalPriceId))throw new Error('INVALID_TRAFFIC_PRICE');form.set('metadata[oryneo_traffic_renewal_price]',input.trafficRenewalPriceId)}
 input.priceIds.forEach((price,index)=>{form.set(`line_items[${index}][price]`,price);form.set(`line_items[${index}][quantity]`,'1')});
 applyCardFundingRestriction(form,input.funding);
 return form;
}

export type OneTimeBoletoCheckoutInput=Readonly<{
 orderId:string;environment:BillingEnvironment;customerEmail:string;amountCents:number;description:string;
 returnUrl:string;integrationIdentifier:string;
}>;

export function buildOneTimeBoletoCheckoutForm(input:OneTimeBoletoCheckoutInput):URLSearchParams{
 if(!/^[0-9a-f-]{36}$/i.test(input.orderId)||!Number.isSafeInteger(input.amountCents)||input.amountCents<=0)throw new Error('INVALID_CHECKOUT_AMOUNT');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail)||input.description.trim().length<3||!/^oryneo_[a-z]+$/.test(input.integrationIdentifier))throw new Error('INVALID_CHECKOUT_CONTEXT');
 const returnUrl=new URL(input.returnUrl);
 if(returnUrl.protocol!=='https:'||returnUrl.hostname!=='guilherme-freitas-oryneo.github.io'||returnUrl.port||returnUrl.username||returnUrl.password||returnUrl.hash||returnUrl.pathname!=='/Oryneo_CRM/pagar/')throw new Error('INVALID_RETURN_URL');
 const form=new URLSearchParams();form.set('mode','payment');form.set('ui_mode','elements');form.set('allowed_payment_method_types[0]','boleto');form.set('customer_creation','always');form.set('customer_email',input.customerEmail);form.set('integration_identifier',input.integrationIdentifier);form.set('locale','pt-BR');form.set('billing_address_collection','required');form.set('return_url',input.returnUrl);
 form.set('line_items[0][price_data][currency]','brl');form.set('line_items[0][price_data][unit_amount]',String(input.amountCents));form.set('line_items[0][price_data][product_data][name]',input.description);form.set('line_items[0][quantity]','1');
 form.set('metadata[oryneo_order_id]',input.orderId);form.set('metadata[oryneo_billing_environment]',input.environment);form.set('metadata[oryneo_payment_method]','boleto');
 form.set('payment_intent_data[metadata][oryneo_order_id]',input.orderId);form.set('payment_intent_data[metadata][oryneo_billing_environment]',input.environment);
 return form;
}

export function buildAssistedCheckoutForm(input:AssistedCheckoutInput):URLSearchParams{
 if(!/^[0-9a-f-]{36}$/i.test(input.obligationId)||!/^[0-9a-f-]{36}$/i.test(input.orderId))throw new Error('INVALID_OBLIGATION');
 if(!['test','live'].includes(input.environment)||!['pix_assisted','boleto_assisted'].includes(input.method))throw new Error('INVALID_PAYMENT_CONTEXT');
 if(!Number.isSafeInteger(input.amountCents)||input.amountCents<=0||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail)||input.label.trim().length<3)throw new Error('INVALID_CHARGE');
 if(!/^[0-9]{4}(-([0-9]{2}|Q[1-4]))?$/.test(input.competenceKey))throw new Error('INVALID_COMPETENCE');
 const method=input.method==='pix_assisted'?'pix':'boleto';
 const form=new URLSearchParams();
 form.set('mode','payment');form.set('locale','pt-BR');form.set('customer_email',input.customerEmail);
 form.set('client_reference_id',input.obligationId);form.set('payment_method_types[0]',method);
 form.set('line_items[0][price_data][currency]','brl');form.set('line_items[0][price_data][unit_amount]',String(input.amountCents));
 form.set('line_items[0][price_data][product_data][name]',input.label);form.set('line_items[0][quantity]','1');
 form.set('metadata[oryneo_obligation_id]',input.obligationId);form.set('metadata[oryneo_order_id]',input.orderId);
 form.set('metadata[oryneo_billing_environment]',input.environment);form.set('metadata[oryneo_assisted_method]',input.method);
 form.set('metadata[oryneo_competence]',input.competenceKey);
 form.set('success_url','https://oryneo.com.br/obrigado?cobranca='+encodeURIComponent(input.competenceKey));
 form.set('cancel_url','https://oryneo.com.br/');
 return form;
}

export type AssistedPixOrderInput=Readonly<{
 orderId:string;environment:BillingEnvironment;customerEmail:string;amountCents:number;description:string;
 returnUrl:string;integrationIdentifier:string;
}>;

/** One-time Pix only: the payment intent is reconciled by the existing webhook. */
export function buildAssistedPixOrderForm(input:AssistedPixOrderInput):URLSearchParams{
 if(!/^[0-9a-f-]{36}$/i.test(input.orderId)||!Number.isSafeInteger(input.amountCents)||input.amountCents<=0)throw new Error('INVALID_PIX_AMOUNT');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail)||input.description.trim().length<3||!/^oryneo_[a-z]+$/.test(input.integrationIdentifier))throw new Error('INVALID_PIX_CONTEXT');
 const url=new URL(input.returnUrl);
 if(url.protocol!=='https:'||url.hostname!=='guilherme-freitas-oryneo.github.io'||url.port||url.username||url.password||url.hash||url.pathname!=='/Oryneo_CRM/pagar/')throw new Error('INVALID_RETURN_URL');
 const form=new URLSearchParams();
 form.set('mode','payment');form.set('ui_mode','elements');form.set('allowed_payment_method_types[0]','pix');
 form.set('customer_email',input.customerEmail);form.set('integration_identifier',input.integrationIdentifier);form.set('locale','pt-BR');
 form.set('return_url',input.returnUrl);
 form.set('line_items[0][price_data][currency]','brl');
 form.set('line_items[0][price_data][unit_amount]',String(input.amountCents));
 form.set('line_items[0][price_data][product_data][name]',input.description);
 form.set('line_items[0][quantity]','1');
 form.set('metadata[oryneo_order_id]',input.orderId);form.set('metadata[oryneo_billing_environment]',input.environment);
 form.set('metadata[oryneo_payment_method]','pix');
 form.set('payment_intent_data[metadata][oryneo_order_id]',input.orderId);
 form.set('payment_intent_data[metadata][oryneo_billing_environment]',input.environment);
 return form;
}
