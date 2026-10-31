/**
 * Minimal canonical read-only context for deterministic shadow decisions.
 * Never copy names, phone numbers, e-mails, message bodies, notes or prompts.
 * Unknown values stay ABSENT: absence is not false and not evidence of payment.
 */
type Row=Record<string,unknown>;
type QueryClient={from:(table:string)=>any};
type SourceRefs=Record<string,unknown>;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid=(v:unknown):v is string=>typeof v==='string'&&UUID.test(v);
const obj=(v:unknown):v is Row=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const nonempty=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=160;
export class ShadowContextError extends Error{
  constructor(readonly code:string){super(code);this.name='ShadowContextError';}
}
const dataOrThrow=(r:{data:unknown;error:unknown}):Row|null=>{
  if(r.error)throw new ShadowContextError('CANONICAL_LOOKUP_FAILED');
  if(r.data===null)return null;
  if(!obj(r.data))throw new ShadowContextError('CANONICAL_RESULT_INVALID');
  return r.data;
};
export type ShadowCanonicalContext={
  event:{type:string};
  opportunity?:{stage_id?:string;source?:string;plan?:string;cycle?:string};
  conversation?:{mode?:string;opted_out?:boolean;consent_granted?:boolean};
  billing?:{status?:string};
};
/**
 * Only references from a trusted server-side inbox may reach this function.
 * The adapter is an observer; it never upgrades payment, consent or a lead
 * qualification flag based on customer text or cached browser data.
 */
export async function loadShadowCanonicalContext(
  db:QueryClient,eventType:string,refs:SourceRefs,
):Promise<ShadowCanonicalContext>{
  if(!nonempty(eventType)||!obj(refs)||Object.keys(refs).some(k=>
    !['opportunity_id','conversation_id','order_id','lead_id'].includes(k) ||
    !isUuid(refs[k])))throw new ShadowContextError('CANONICAL_REFERENCES_INVALID');
  const context:ShadowCanonicalContext={event:{type:eventType}};
  let dealId=isUuid(refs.opportunity_id)?refs.opportunity_id:null;
  if(isUuid(refs.conversation_id)){
    const conversation=dataOrThrow(await db.from('crm_wa_conversations')
      .select('id,deal_id,mode,opted_out,consent_granted')
      .eq('id',refs.conversation_id).maybeSingle());
    if(!conversation)throw new ShadowContextError('CONVERSATION_NOT_FOUND');
    const values:NonNullable<ShadowCanonicalContext['conversation']>={};
    if(nonempty(conversation.mode))values.mode=conversation.mode;
    if(typeof conversation.opted_out==='boolean')values.opted_out=conversation.opted_out;
    if(typeof conversation.consent_granted==='boolean')values.consent_granted=conversation.consent_granted;
    context.conversation=values;
    if(isUuid(conversation.deal_id)){
      if(dealId&&dealId!==conversation.deal_id)
        throw new ShadowContextError('CONVERSATION_DEAL_MISMATCH');
      dealId=conversation.deal_id;
    }
  }
  if(dealId){
    const deal=dataOrThrow(await db.from('crm_records').select('id,kind,deleted,data')
      .eq('id',dealId).maybeSingle());
    if(!deal||deal.kind!=='deal'||deal.deleted!==false||!obj(deal.data))
      throw new ShadowContextError('OPPORTUNITY_NOT_FOUND');
    const data=deal.data;
    const values:NonNullable<ShadowCanonicalContext['opportunity']>={};
    if(isUuid(data.stage_id))values.stage_id=data.stage_id;
    if(nonempty(data.source))values.source=data.source;
    // The only plan/cycle source is the canonical accepted quote, not free text.
    if(obj(data.quote)){
      if(['Start','Growth','Scale'].includes(String(data.quote.plan)))
        values.plan=String(data.quote.plan);
      if(['monthly','annual'].includes(String(data.quote.cycle)))
        values.cycle=String(data.quote.cycle);
    }
    context.opportunity=values;
  }
  if(isUuid(refs.order_id)){
    const order=dataOrThrow(await db.from('crm_billing_orders')
      .select('id,deal_id,status').eq('id',refs.order_id).maybeSingle());
    if(!order)throw new ShadowContextError('ORDER_NOT_FOUND');
    if(dealId&&order.deal_id!==dealId)throw new ShadowContextError('ORDER_DEAL_MISMATCH');
    if(nonempty(order.status))context.billing={status:order.status};
    // A paid status alone is NOT proof of a verified Stripe webhook.
    // billing.paid_verified stays absent until its provenance adapter ships.
  }
  return context;
}
