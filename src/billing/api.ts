import { supabase,errorText } from '../data';
import type { PreparedBilling } from './BillingAction';
export async function prepareBilling(dealId:string):Promise<PreparedBilling>{
 const {data,error}=await supabase.functions.invoke('billing-create-order',{body:{deal_id:dealId}});
 if(error)throw new Error(errorText(error));if(!data?.url||!data?.reference)throw new Error(data?.error||'Não foi possível preparar a cobrança.');
 return {url:data.url,reference:data.reference};
}
