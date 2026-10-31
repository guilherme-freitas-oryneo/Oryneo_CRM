import {loadMetaCanonicalContext} from '../automation-api/metaCanonicalContext.ts';
import {resolveTemplateBindings} from '../automation-api/templateBindings.ts';
type Obj=Record<string,unknown>;
const eq=(a:unknown,b:unknown,m:string)=>{if(a!==b)throw Error(m+': '+String(a));};
const baseConversation={
 id:'11111111-1111-4111-8111-111111111111',
 deal_id:'22222222-2222-4222-8222-222222222222',
 channel_id:'33333333-3333-4333-8333-333333333333',
 customer_wa_id:'5521999887766',customer_name:'Contato Homologação',
 mode:'sdr_active',opted_out:false,consent_granted:true,
};
const baseDeal={id:baseConversation.deal_id,kind:'deal',deleted:false,
 data:{title:'Solicitação Growth',source:'landing',
 quote:{plan:'Growth',cycle:'annual'},form_submission:{primary_goal:'Organizar retornos'},
 next_action:{title:'Agendar diagnóstico'},company:'Empresa Exemplo'}};
function db(rows:Record<string,Obj|null>){
 return {from:(name:string)=>({
  select(){return this},eq(){return this},order(){return this},limit(){return this},
  async maybeSingle(){return {data:rows[name]??null,error:null}},
 })};
}
const ref=baseConversation.id;
Deno.test('canonical WhatsApp context reads verified quote and priority only',async()=>{
 const result=await loadMetaCanonicalContext(db({
  crm_wa_conversations:baseConversation,crm_records:baseDeal,crm_events:null,
 }),ref);
 eq(result.recipient,'5521999887766','recipient');
 const mapped=resolveTemplateBindings({
  '1':'conversation.customer_name','2':'opportunity.cycle',
  '3':'opportunity.priority'},['1','2','3'],result.context);
 if(!mapped.ok)throw Error('binding failed');
 eq(mapped.values.join('|'),
  'Contato Homologação|anual|Organizar retornos','canonical fields');
});
Deno.test('human takeover, opt out and absent consent block content retrieval',async()=>{
 for(const update of [{mode:'human_locked'},{opted_out:true},{consent_granted:false}]){
  let blocked=false;
  try{await loadMetaCanonicalContext(db({
   crm_wa_conversations:{...baseConversation,...update},
   crm_records:baseDeal,crm_events:null,
  }),ref)}catch{blocked=true}
  if(!blocked)throw Error('policy bypass');
 }
});
Deno.test('meeting fields require explicit confirmed appointment provenance',async()=>{
 const result=await loadMetaCanonicalContext(db({
  crm_wa_conversations:baseConversation,crm_records:baseDeal,
  crm_events:{actor:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   detail:{scheduled_at:'2026-10-31T15:00:00Z',
    confirmed_at:'2026-10-30T14:00:00Z',format:'online'}},
 }),ref);
 const ok=resolveTemplateBindings({
  '1':'conversation.customer_name','2':'meeting.date',
  '3':'meeting.time','4':'meeting.format'},
  ['1','2','3','4'],result.context);
 if(!ok.ok)throw Error('confirmed meeting not resolved');
 eq(ok.values.slice(1).join('|'),'31/10/2026|12:00|Online','timezone formatting');
 const missing=await loadMetaCanonicalContext(db({
  crm_wa_conversations:baseConversation,crm_records:baseDeal,
  crm_events:{actor:null,detail:{scheduled_at:'2026-10-31T15:00:00Z',format:'online'}},
 }),ref);
 const blocked=resolveTemplateBindings({'1':'meeting.date'},['1'],missing.context);
 eq(blocked.ok,false,'unconfirmed meeting was incorrectly sent');
});
