import type {PaymentMethod} from './payment-policy.ts';
import type {BillingEnvironmentConfig} from './environment.ts';

export type StripeMethodAvailability=Readonly<{available:boolean;reason:'enabled'|'disabled'|'unavailable'|'configuration_error'}>;
/** A method must be available AND switched on in the selected Stripe environment.
 * LIVE and TEST configurations are independent. Never infer from the other account.
 */
export async function checkStripeMethodAvailability(
 method:PaymentMethod,config:BillingEnvironmentConfig,fetchImpl:typeof fetch=fetch,
):Promise<StripeMethodAvailability>{
 try{
  const res=await fetchImpl('https://api.stripe.com/v1/payment_method_configurations?limit=20',{
   headers:{Authorization:'Bearer '+config.secretKey,'Stripe-Version':'2026-08-26.dahlia'},
  });
  if(!res.ok)return {available:false,reason:'configuration_error'};
  const body=await res.json() as {data?:Array<Record<string,unknown>>;has_more?:boolean};
  if(!Array.isArray(body.data)||body.has_more)return {available:false,reason:'configuration_error'};
  const configs=body.data.filter(c=>c.active===true&&c.livemode===config.livemode);
  if(configs.length!==1)return {available:false,reason:'configuration_error'};
  const entry=configs[0][method] as {available?:boolean;display_preference?:{value?:string}}|undefined;
  if(!entry||entry.available!==true)return {available:false,reason:'unavailable'};
  if(entry.display_preference?.value!=='on')return {available:false,reason:'disabled'};
  return {available:true,reason:'enabled'};
 }catch{return {available:false,reason:'configuration_error'}}
}
