import {resolvePaymentPolicy,type PaymentMethod,type PaymentCycle} from './payment-policy.ts';
export type CheckoutPaymentConfiguration=Readonly<{mode:'subscription'|'payment';paymentMethodTypes:readonly ['card']|readonly ['boleto']|readonly ['pix'];collectionMethod:'charge_automatically'|'send_invoice'|null;description:string}>;
/**
 * Integration contract only. Checkout must validate account/currency/cycle support
 * and invoice settings with Stripe before enabling any non-card option.
 * Never pass these parameters to LIVE until webhook and E2E gates are complete.
 */
export function checkoutPaymentConfiguration(method:PaymentMethod,cycle:PaymentCycle):CheckoutPaymentConfiguration{
 const policy=resolvePaymentPolicy(method,cycle);
 switch(policy.method){
 case 'card':return {mode:'subscription',paymentMethodTypes:['card'],collectionMethod:'charge_automatically',description:'Assinatura por cartão'};
 case 'boleto':return {mode:'subscription',paymentMethodTypes:['boleto'],collectionMethod:'send_invoice',description:'Assinatura faturada por boleto; cada fatura exige pagamento'};
 case 'pix':return {mode:'payment',paymentMethodTypes:['pix'],collectionMethod:null,description:'Pagamento avulso por Pix, sem renovação automática'};
 }
}
