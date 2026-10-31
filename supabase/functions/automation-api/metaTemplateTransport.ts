import {buildMetaTemplateRequest} from './metaTemplateRequest.ts';
import {inspectFreshMetaApproval,type TemplateProof} from './metaTemplateApproval.ts';
export type Requester=(input:string|URL,init?:RequestInit)=>Promise<Response>;
export type DeliveryOutcome=
 |{kind:'accepted';receipt:string}
 |{kind:'definitive_rejection';code:'META_REJECTED'}
 |{kind:'uncertain';code:'META_OUTCOME_UNKNOWN'};
const graph='https://graph.facebook.com/v26.0/';
const providerReceipt=(x:unknown):x is string=>
 typeof x==='string'&&x.length>=3&&x.length<=512
 &&/^[A-Za-z0-9_.:/=-]+$/.test(x);
export async function freshApprovedTemplate(
 requester:Requester,token:string,proof:TemplateProof,
):Promise<boolean>{
 if(!/^[0-9]{8,24}$/.test(proof.id)||!token)
  return false;
 try{
  const result=await requester(graph+proof.id+
    '?fields=id,name,status,language,category,components',{
    method:'GET',headers:{Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(15000),
  });
  if(!result.ok)return false;
  const body=await result.json();
  return inspectFreshMetaApproval(body,proof).approved===true;
 }catch{return false;}
}
export async function sendVerifiedTemplate(
 requester:Requester,token:string,phoneNumberId:string,
 input:{recipient:string;name:string;locale:string;
  values:string[];expectedCount:number},
):Promise<DeliveryOutcome>{
 if(!/^[0-9]{8,24}$/.test(phoneNumberId)||!token)
  throw Error('META_SENDER_CONFIG_INVALID');
 const request=buildMetaTemplateRequest(input);
 try{
  const result=await requester(graph+phoneNumberId+'/messages',{
   method:'POST',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify(request),signal:AbortSignal.timeout(15000),
  });
  const body=await result.json().catch(()=>null);
  const rawId=body&&typeof body==='object'
   ?(body as {messages?:Array<{id?:unknown}>}).messages?.[0]?.id:null;
  if(result.ok&&providerReceipt(rawId))
   return {kind:'accepted',receipt:rawId};
  // A successful HTTP status without a durable receipt is ambiguous.
  if(result.ok)return {kind:'uncertain',code:'META_OUTCOME_UNKNOWN'};
  // A structured 4xx API refusal without a message receipt is definitive.
  // Rate limiting is not automatically replayed: the operator decides.
  const providerError=body&&typeof body==='object'
   &&typeof (body as {error?:{code?:unknown}}).error?.code==='number';
  if(result.status>=400&&result.status<500&&providerError&&!rawId)
   return {kind:'definitive_rejection',code:'META_REJECTED'};
  return {kind:'uncertain',code:'META_OUTCOME_UNKNOWN'};
 }catch{
  // Network timeout, lost response and 5xx can all represent an actual send.
  // NEVER retry an ambiguous WhatsApp request.
  return {kind:'uncertain',code:'META_OUTCOME_UNKNOWN'};
 }
}
