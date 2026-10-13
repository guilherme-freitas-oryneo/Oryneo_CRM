import { supabase,errorText } from '../data';
import type { PreparedBilling } from './BillingAction';

export async function billingErrorText(error:unknown){
 const context=(error as {context?:unknown})?.context;
 if(context instanceof Response){
  try{const payload=await context.clone().json() as {error?:unknown};if(typeof payload.error==='string'&&payload.error.trim())return payload.error.trim()}catch{/* fallback below */}
 }
 return errorText(error);
}

export async function prepareBilling(dealId:string):Promise<PreparedBilling>{
 const {data,error}=await supabase.functions.invoke('billing-create-order',{body:{deal_id:dealId}});
 if(error)throw new Error(await billingErrorText(error));if(!data?.url||!data?.reference)throw new Error(data?.error||'Não foi possível preparar a cobrança.');
 return {url:data.url,reference:data.reference};
}
