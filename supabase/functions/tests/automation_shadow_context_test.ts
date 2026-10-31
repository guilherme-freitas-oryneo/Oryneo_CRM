import {loadShadowCanonicalContext,ShadowContextError} from '../automation-api/shadowContext.ts';

const OPP='11111111-1111-4111-8111-111111111111';
const WA='22222222-2222-4222-8222-222222222222';
const ORDER='33333333-3333-4333-8333-333333333333';
const STAGE='44444444-4444-4444-8444-444444444444';
const assert=(ok:boolean,detail:string)=>{if(!ok)throw Error(detail);};
const model=()=>({
  crm_wa_conversations:[{id:WA,deal_id:OPP,mode:'human_locked',opted_out:true,consent_granted:false,
    customer_wa_id:'5521000000000',customer_name:'DO NOT COPY'}],
  crm_records:[{id:OPP,kind:'deal',deleted:false,data:{
    stage_id:STAGE,source:'Formulário',notes:'private',
    phone:'5521000000000',email:'secret@example.com',
    quote:{plan:'Growth',cycle:'annual',amount:'PRIVATE'}}}],
  crm_billing_orders:[{id:ORDER,deal_id:OPP,status:'paid',stripe_invoice_id:'secret'}],
});
function db(rows=model(),fails?:string){
  return {from:(table:string)=>{
    let id='';
    return {select(_columns:string){
      return {eq(_key:string,value:string){
        id=value;
        return {async maybeSingle(){
          if(table===fails)return {data:null,error:{message:'db error'}};
          const value=(rows as Record<string,Array<Record<string,unknown>>>)[table]?.find(r=>r.id===id)||null;
          return {data:value,error:null};
        }};
      }};
    }};
  }};
}
async function rejected(run:()=>Promise<unknown>,expected:string){
  try{await run();throw Error('Expected rejection '+expected);}
  catch(e){assert(e instanceof ShadowContextError && e.code===expected,
    'Wrong failure: '+String(e));}
}
Deno.test('shadow hydration reads authoritative stage, source and bounded quote, never PII',async()=>{
 const ctx=await loadShadowCanonicalContext(db(),'opportunity.created',{opportunity_id:OPP});
 assert(ctx.opportunity?.stage_id===STAGE,'stage was not canonical');
 assert(ctx.opportunity?.plan==='Growth'&&ctx.opportunity?.cycle==='annual','quote mismatch');
 assert(ctx.opportunity?.source==='Formulário','source mismatch');
 assert(!JSON.stringify(ctx).includes('PRIVATE')&&!JSON.stringify(ctx).includes('secret'),'PII leaked');
 assert(!Object.hasOwn(ctx,'billing'),'missing order became paid');
});
Deno.test('WhatsApp human mode, opt-out, consent read from canonical conversation',async()=>{
 const ctx=await loadShadowCanonicalContext(db(),'conversation.inbound',{conversation_id:WA});
 assert(ctx.conversation?.mode==='human_locked','operator mode was lost');
 assert(ctx.conversation?.opted_out===true&&ctx.conversation?.consent_granted===false,
  'human messaging gates defaulted to permissive state');
 assert(ctx.opportunity?.stage_id===STAGE,'linked opportunity was not resolved');
 assert(!JSON.stringify(ctx).includes('5521'),'WhatsApp number leaked');
});
Deno.test('financial claims are never converted to payment verified from status alone',async()=>{
 const ctx=await loadShadowCanonicalContext(db(),'billing.paid_verified',
 {order_id:ORDER,opportunity_id:OPP});
 assert(ctx.billing?.status==='paid','status not read');
 assert(!Object.hasOwn(ctx.billing||{},'paid_verified'),'status implies webhook verification');
});
Deno.test('foreign conversation->deal link and foreign order cannot cross scopes',async()=>{
 const other='55555555-5555-4555-8555-555555555555';
 await rejected(()=>loadShadowCanonicalContext(db(),'conversation.inbound',
  {conversation_id:WA,opportunity_id:other}),'CONVERSATION_DEAL_MISMATCH');
 await rejected(()=>loadShadowCanonicalContext(db(),'billing.paid_verified',
  {order_id:ORDER,opportunity_id:other}),'OPPORTUNITY_NOT_FOUND');
});
Deno.test('bad references, missing canonical records and provider failure fail closed',async()=>{
 await rejected(()=>loadShadowCanonicalContext(db(),'conversation.inbound',
  {conversation_id:'not-uuid'}),'CANONICAL_REFERENCES_INVALID');
 await rejected(()=>loadShadowCanonicalContext(db(),'conversation.inbound',
  {conversation_id:WA,unexpected:'secret'}),'CANONICAL_REFERENCES_INVALID');
 await rejected(()=>loadShadowCanonicalContext(db(),'conversation.inbound',
  {conversation_id:'66666666-6666-4666-8666-666666666666'}),'CONVERSATION_NOT_FOUND');
 await rejected(()=>loadShadowCanonicalContext(db(model(),'crm_records'),
  'opportunity.created',{opportunity_id:OPP}),'CANONICAL_LOOKUP_FAILED');
});
Deno.test('unknown lead intent and missing billing values stay unknown, not false',async()=>{
 const ctx=await loadShadowCanonicalContext(db(),'lead.intake_received',{lead_id:OPP});
 assert(!Object.hasOwn(ctx,'opportunity')&&!Object.hasOwn(ctx,'billing'), 'noncanonical data invented');
 assert(!Object.hasOwn(ctx,'lead'),'unproven lead intent invented');
 assert(ctx.event.type==='lead.intake_received','event type lost');
});
