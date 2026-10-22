import {resolvePaymentPolicy,type PaymentMethod,type PaymentCycle} from './payment-policy.ts';

/**
 * Business intent, NOT Stripe API parameters. In particular, Stripe Checkout
 * subscription mode must not be assumed to support boleto merely because
 * boleto is enabled on the account. Invoice issuance and Checkout payment
 * methods are distinct provider workflows.
 */
export type PaymentIntegrationPlan=Readonly<{
 method:PaymentMethod;
 cycle:PaymentCycle;
 workflow:'checkout_subscription'|'subscription_invoicing'|'one_time_checkout';
 stripeMode:'subscription'|'payment'|null;
 customerPaysEachInvoice:boolean;
 readyForLive:boolean;
}>;
export function checkoutPaymentConfiguration(method:PaymentMethod,cycle:PaymentCycle):PaymentIntegrationPlan{
 const policy=resolvePaymentPolicy(method,cycle);
 switch(policy.method){
  case 'card':return {method,cycle,workflow:'checkout_subscription',stripeMode:'subscription',customerPaysEachInvoice:false,readyForLive:true};
  case 'boleto':return {method,cycle,workflow:'subscription_invoicing',stripeMode:'subscription',customerPaysEachInvoice:true,readyForLive:true};
  case 'pix':return {method,cycle,workflow:'one_time_checkout',stripeMode:'payment',customerPaysEachInvoice:false,readyForLive:false};
 }
}
/** Never enable a payment method based only on account-level availability. */
export function assertPaymentMethodEnabled(method:PaymentMethod,cycle:PaymentCycle):void{
 const plan=checkoutPaymentConfiguration(method,cycle);
 if(!plan.readyForLive)throw new Error('PAYMENT_METHOD_NOT_HOMOLOGATED');
}
