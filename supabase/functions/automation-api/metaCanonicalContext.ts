/**
 * Consent-gated PII read for one Meta template action.
 * This is intentionally NOT part of shadow simulation, logs or public
 * catalog. Missing canonical evidence causes refusal, not a fallback text.
 */
type DB={from:(table:string)=>any};
type Dict=Record<string,unknown>;
const object=(x:unknown):x is Dict=>!!x&&typeof x==='object'&&!Array.isArray(x);
const text=(x:unknown,max=160):string|undefined=>
 typeof x==='string'&&x.trim().length>0&&x.trim().length<=max
  ?x.trim():undefined;
const uuid=(x:unknown):x is string=>
 typeof x==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x);
export type MetaCanonicalResult={
 recipient:string;conversationId:string;channelId:string;
 context:Dict;
};
export async function loadMetaCanonicalContext(
 db:DB,conversationId:string,
):Promise<MetaCanonicalResult>{
 if(!uuid(conversationId))throw Error('META_CONVERSATION_ID_INVALID');
 const {data:conv,error:convError}=await db.from('crm_wa_conversations')
  .select('id,channel_id,customer_wa_id,customer_name,deal_id,mode,opted_out,consent_granted')
  .eq('id',conversationId).maybeSingle();
 if(convError||!conv||conv.mode!=='sdr_active'
   ||conv.opted_out!==false||conv.consent_granted!==true
   ||!uuid(conv.channel_id)||!uuid(conv.deal_id))
  throw Error('META_CONVERSATION_POLICY_DENIED');
 if(typeof conv.customer_wa_id!=='string'
   ||!/^[0-9]{8,32}$/.test(conv.customer_wa_id))
  throw Error('META_RECIPIENT_NOT_VERIFIED');
 const {data:deal,error:dealError}=await db.from('crm_records')
  .select('id,kind,deleted,data').eq('id',conv.deal_id).maybeSingle();
 if(dealError||!deal||deal.kind!=='deal'||deal.deleted!==false||!object(deal.data))
  throw Error('META_CANONICAL_OPPORTUNITY_MISSING');
 const data=deal.data;
 const quote=object(data.quote)?data.quote:{};
 const form=object(data.form_submission)?data.form_submission:{};
 const next=object(data.next_action)?data.next_action:{};
 const cycle=quote.cycle==='monthly'?'mensal':quote.cycle==='annual'?'anual':undefined;
 const context:Dict={
  conversation:{customer_name:text(conv.customer_name,160)},
  opportunity:{
   title:text(data.title),source:text(data.source),
   plan:['Start','Growth','Scale'].includes(String(quote.plan))?quote.plan:undefined,
   cycle,priority:text(form.primary_goal),
   next_action:{title:text(next.title)},
  },
  billing:{company:text(data.company)},
 };
 // Meeting data must come from an explicitly confirmed CRM event. A string
 // in a chat, a guessed time or a calendar date without human approval is
 // never sufficient to populate a meeting confirmation template.
 const {data:meeting,error:meetingError}=await db.from('crm_events')
  .select('id,actor,event_type,detail,created_at')
  .eq('deal_id',conv.deal_id).eq('event_type','meeting_scheduled')
  .order('created_at',{ascending:false}).limit(1).maybeSingle();
 if(meetingError)throw Error('META_MEETING_PROVENANCE_UNAVAILABLE');
 if(meeting&&uuid(meeting.actor)&&object(meeting.detail)
   &&text(meeting.detail.confirmed_at,40)
   &&!meeting.detail.cancelled_at){
  const stamp=text(meeting.detail.scheduled_at,40);
  const instant=stamp?new Date(stamp):null;
  const mode=meeting.detail.format;
  if(instant&&!Number.isNaN(instant.getTime())
   &&(mode==='online'||mode==='presencial')){
   const date=new Intl.DateTimeFormat('pt-BR',{
    timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',
   }).format(instant);
   const time=new Intl.DateTimeFormat('pt-BR',{
    timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hour12:false,
   }).format(instant);
   context.meeting={date,time,format:mode==='online'?'Online':'Presencial'};
  }
 }
 return {
  recipient:conv.customer_wa_id,conversationId,channelId:conv.channel_id,
  context,
 };
}
