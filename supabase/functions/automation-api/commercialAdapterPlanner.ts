/**
 * Stage3 provider-agnostic commercial adapter contract.
 * This is a pure, non-emitting handoff planner: NO network, secrets, personal
 * data, database writes or permission to send/charge. It centralizes the
 * canonical data that a future exclusive live transport must rehydrate.
 */
import {reviewCommercialAction,type CommercialAction,type CommercialEvidence,
 type CommercialChannel} from './commercialActionPolicy.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/i;
export type CanonicalRefs={
  opportunity_id?:string;conversation_id?:string;order_id?:string;lead_id?:string;
};
export type HandoffRequest={
  workspaceId:string;flowVersionId:string;nodeId:string;
  actionKey:string;actionType:CommercialAction;refs:CanonicalRefs;
};
export type HandoffPlan={
  status:'rejected'|'prepared';
  reason:string;channel:CommercialChannel|null;deduplicationKey:string|null;
  workspaceId:string|null;actionKey:string|null;
  sourceRefType:'opportunity_id'|'conversation_id'|'order_id'|null;
  sourceRefId:string|null;dispatchAuthorized:false;
};
const denied=(code:string):HandoffPlan=>({
 status:'rejected',reason:code,channel:null,deduplicationKey:null,
 workspaceId:null,actionKey:null,sourceRefType:null,sourceRefId:null,
 dispatchAuthorized:false,
});
async function fingerprint(values:readonly string[]):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',
   new TextEncoder().encode(JSON.stringify(values)));
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
/** The target service MUST recheck all facts immediately before side effects. */
export async function planCommercialHandoff(
 request:HandoffRequest,evidence:CommercialEvidence,
):Promise<HandoffPlan>{
 if(!UUID.test(request.workspaceId)||!UUID.test(request.flowVersionId)
  ||!UUID.test(request.nodeId)||!HASH.test(request.actionKey))
  return denied('INVALID_IMMUTABLE_IDENTITY');
 if(request.actionType!==evidence.actionType)
  return denied('ACTION_TYPE_MISMATCH');
 if(!request.refs||typeof request.refs!=='object'||Array.isArray(request.refs)
   ||Object.keys(request.refs).some(k=>!['opportunity_id','conversation_id',
      'order_id','lead_id'].includes(k))
   ||Object.values(request.refs).some(v=>typeof v!=='string'||!UUID.test(v)))
  return denied('CANONICAL_REFERENCES_REQUIRED');
 const review=reviewCommercialAction(evidence);
 if(!review.eligibleForControlledQueue)return denied(review.code);
 const channel=review.channel;
 if(!channel)return denied('CHANNEL_UNSUPPORTED');
 let refType:HandoffPlan['sourceRefType']=null;
 if(channel==='whatsapp')refType='conversation_id';
 if(channel==='email'||channel==='crm')refType='opportunity_id';
 if(channel==='onboarding'||channel==='billing')refType='order_id';
 if(!refType||!request.refs[refType])return denied('REQUIRED_CANONICAL_SOURCE_MISSING');
 const id=request.refs[refType]!;
 return {
  status:'prepared',reason:'SERVER_REVALIDATION_REQUIRED',
  channel,workspaceId:request.workspaceId,actionKey:request.actionKey,
  deduplicationKey:await fingerprint([request.workspaceId,request.flowVersionId,
    request.nodeId,request.actionKey,channel,refType,id]),
  sourceRefType:refType,sourceRefId:id,dispatchAuthorized:false,
 };
}
