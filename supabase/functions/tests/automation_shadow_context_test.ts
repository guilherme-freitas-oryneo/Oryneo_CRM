import {loadShadowCanonicalContext,ShadowContextError} from '../automation-api/shadowContext.ts';
const OPP='11111111-1111-4111-8111-111111111111';
const WA='22222222-2222-4222-8222-222222222222';
const ORDER='33333333-3333-4333-8333-333333333333';
const STAGE='44444444-4444-4444-8444-444444444444';
function assert(ok:unknown,detail:string):asserts ok{if(!ok)throw Error(detail);}
type Row=Record<string,unknown>;
type Tables=Record<string,Row[]>;
function model():Tables{return {
 crm_wa_conversations:[{id:WA,deal_id:OPP,mode:'human_locked',opted_out:true,
   consent_granted:false,customer_name:'SECRET PERSON',customer_wa_id:'5521000000000'}],
 crm_records:[{id:OPP,kind:'deal',deleted:false,data:{
   stage_id:STAGE,source:'Formulário',notes:'private',phone:'5521000000000',
   email:'secret@example.com',quote:{plan:'Growth',cycle:'annual',amount:'PRIVATE'}}}],
 crm_billing_orders:[{id:ORDER,deal_id:OPP,status:'paid',
   paid_at:'2026-10-31T16:00:00Z',billing_environment:'live',
   stripe_checkout_session_id:'cs_verified_qa',customer_email:'secret@example.com'}],
 crm_stripe_events:[{event_id:'evt_verified_qa',event_type:'checkout.session.completed',
   livemode:true,payload:{session_id:'cs_verified_qa',payment_status:'paid',
     name:'PRIVATE'}}],
 crm_delivery_projects:[{order_id:ORDER,status:'pending_kickoff'}],
};}
function db(rows:Tables=model(),fails?:string){
 return {from:(table:string)=>({select(_columns:string){
   let predicate=(row:Row)=>true;
   const chain={
     eq(key:string,value:unknown){
       const prior=predicate;predicate=(r:Row)=>prior(r)&&r[key]===value;return chain;
     },
     in(key:string,values:unknown[]){
       const prior=predicate;predicate=(r:Row)=>prior(r)&&values.includes(r[key]);return chain;
     },
     contains(key:string,sub:Row){
       const prior=predicate;
       predicate=(r:Row)=>prior(r)&&!!r[key]&&typeof r[key]==='object'
         &&Object.entries(sub).every(([k,v])=>(r[key] as Row)[k]===v);
       return chain;
     },
     limit(_amount:number){return chain;},
     async maybeSingle(){
       if(table===fails)return {data:null,error:{message:'read denied'}};
       return {data:rows[table]?.find(predicate)||null,error:null};
     },
   };
   return chain;
 }})};
}
async function rejected(run:()=>Promise<unknown>,expected:string){
 try{await run();throw Error('Expected rejection '+expected);}
 catch(e){assert(e instanceof ShadowContextError&&e.code===expected,
  'Wrong failure: '+String(e));}
}
Deno.test('canonical opportunity stage, source and quote without PII',async()=>{
 const ctx=await loadShadowCanonicalContext(db(),'opportunity.created',{opportunity_id:OPP});
 assert(ctx.opportunity?.stage_id===STAGE,'Stage not canonical');
 assert(ctx.opportunity?.plan==='Growth'&&ctx.opportunity?.cycle==='annual','Quote mismatch');
 assert(!JSON.stringify(ctx).includes('PRIVATE')&&!JSON.stringify(ctx).includes('secret'),'PII leak');
 assert(!Object.hasOwn(ctx,'billing'),'Unknown order implied payment');
});
Deno.test('WhatsApp canonical handoff, opt-out and consent without contact details',async()=>{
 const ctx=await loadShadowCanonicalContext(db(),'conversation.inbound',{conversation_id:WA});
 assert(ctx.conversation?.mode==='human_locked','Mode mismatch');
 assert(ctx.conversation?.opted_out===true&&ctx.conversation?.consent_granted===false,'Unsafe consent');
 assert(ctx.opportunity?.stage_id===STAGE,'Linked opportunity missing');
 assert(!JSON.stringify(ctx).includes('5521'),'Contact details leaked');
});
Deno.test('Paid status without matching signed live Stripe event fails closed',async()=>{
 const rows=model();rows.crm_stripe_events=[];
 await rejected(()=>loadShadowCanonicalContext(db(rows),'billing.paid_verified',
   {order_id:ORDER,opportunity_id:OPP}),'SIGNED_STRIPE_EVENT_NOT_FOUND');
 const innocent=await loadShadowCanonicalContext(db(rows),'opportunity.updated',
   {order_id:ORDER,opportunity_id:OPP});
 assert(innocent.billing?.status==='paid','Raw order status must remain visible');
 assert(!Object.hasOwn(innocent.billing||{},'paid_verified'),'Status alone is verified');
});
Deno.test('Verified Stripe event + order + payment date permit true only for paid_verified',async()=>{
 const context=await loadShadowCanonicalContext(db(),'billing.paid_verified',
   {order_id:ORDER,opportunity_id:OPP});
 assert(context.billing?.status==='paid'&&context.billing.paid_verified===true,
   'Verified canonical payment not recognized');
 assert(!JSON.stringify(context).includes('cs_verified_qa'),'Stripe ID leaked');
 const another=await loadShadowCanonicalContext(db(),'opportunity.updated',
   {order_id:ORDER,opportunity_id:OPP});
 assert(!Object.hasOwn(another.billing||{},'paid_verified'),'Ordinary event upgraded payment');
});
Deno.test('Webhook live mismatch, unpaid order and missing paid_at deny verification',async()=>{
 const a=model();a.crm_stripe_events[0].livemode=false;
 await rejected(()=>loadShadowCanonicalContext(db(a),'billing.paid_verified',
   {order_id:ORDER}),'SIGNED_STRIPE_EVENT_NOT_FOUND');
 const b=model();b.crm_billing_orders[0].billing_environment='test';
 await rejected(()=>loadShadowCanonicalContext(db(b),'billing.paid_verified',
   {order_id:ORDER}),'STRIPE_PROVENANCE_UNAVAILABLE');
 const c=model();c.crm_billing_orders[0].paid_at=null;
 await rejected(()=>loadShadowCanonicalContext(db(c),'billing.paid_verified',
   {order_id:ORDER}),'CANONICAL_ORDER_STATUS_MISMATCH');
 const d=model();d.crm_stripe_events[0].payload={session_id:'cs_verified_qa',payment_status:'unpaid'};
 await rejected(()=>loadShadowCanonicalContext(db(d),'billing.paid_verified',
   {order_id:ORDER}),'SIGNED_STRIPE_EVENT_NOT_FOUND');
});
Deno.test('Post-sale onboarding requires an existing delivery project AND signed payment',async()=>{
 const valid=await loadShadowCanonicalContext(db(),'onboarding.started',{order_id:ORDER});
 assert(valid.billing?.paid_verified===true,'Onboarding had no signed payment');
 const missing=model();missing.crm_delivery_projects=[];
 await rejected(()=>loadShadowCanonicalContext(db(missing),'onboarding.started',
   {order_id:ORDER}),'ONBOARDING_PROJECT_NOT_FOUND');
 const forged=model();forged.crm_stripe_events=[];
 await rejected(()=>loadShadowCanonicalContext(db(forged),'onboarding.started',
   {order_id:ORDER}),'SIGNED_STRIPE_EVENT_NOT_FOUND');
});
Deno.test('Failed checkout cannot impersonate paid: signed failed event required',async()=>{
 const rows=model();rows.crm_billing_orders[0].status='payment_failed';
 rows.crm_billing_orders[0].paid_at=null;
 rows.crm_stripe_events[0].event_type='checkout.session.async_payment_failed';
 const valid=await loadShadowCanonicalContext(db(rows),'billing.failed',{order_id:ORDER});
 assert(valid.billing?.status==='payment_failed','Canonical failure lost');
 assert(!Object.hasOwn(valid.billing||{},'paid_verified'),'Failure looked paid');
 rows.crm_stripe_events[0].event_type='checkout.session.completed';
 await rejected(()=>loadShadowCanonicalContext(db(rows),'billing.failed',
   {order_id:ORDER}),'SIGNED_STRIPE_EVENT_NOT_FOUND');
});
Deno.test('Expired checkout requires a verified expired provider journal',async()=>{
 const rows=model();rows.crm_billing_orders[0].status='expired';
 rows.crm_stripe_events[0].event_type='checkout.session.expired';
 const valid=await loadShadowCanonicalContext(db(rows),'checkout.expired',{order_id:ORDER});
 assert(valid.billing?.status==='expired','Expiry not canonical');
 rows.crm_stripe_events=[];
 await rejected(()=>loadShadowCanonicalContext(db(rows),'checkout.expired',
   {order_id:ORDER}),'SIGNED_STRIPE_EVENT_NOT_FOUND');
});
Deno.test('Checkout started requires a canonical live session',async()=>{
 const rows=model();rows.crm_billing_orders[0].stripe_checkout_session_id=null;
 await rejected(()=>loadShadowCanonicalContext(db(rows),'checkout.started',
   {order_id:ORDER}),'CHECKOUT_SESSION_NOT_CONFIRMED');
});
Deno.test('Cross-deal conversation and foreign orders never enter context',async()=>{
 const other='55555555-5555-4555-8555-555555555555';
 await rejected(()=>loadShadowCanonicalContext(db(),'conversation.inbound',
   {conversation_id:WA,opportunity_id:other}),'CONVERSATION_DEAL_MISMATCH');
 await rejected(()=>loadShadowCanonicalContext(db(),'billing.paid_verified',
   {order_id:ORDER,opportunity_id:other}),'OPPORTUNITY_NOT_FOUND');
});
Deno.test('Bad references and canonical DB outages are fail closed',async()=>{
 await rejected(()=>loadShadowCanonicalContext(db(),'conversation.inbound',
   {conversation_id:'not-uuid'}),'CANONICAL_REFERENCES_INVALID');
 await rejected(()=>loadShadowCanonicalContext(db(),'conversation.inbound',
   {conversation_id:WA,unexpected:'secret'}),'CANONICAL_REFERENCES_INVALID');
 await rejected(()=>loadShadowCanonicalContext(db(),'conversation.inbound',
   {conversation_id:'66666666-6666-4666-8666-666666666666'}),'CONVERSATION_NOT_FOUND');
 await rejected(()=>loadShadowCanonicalContext(db(model(),'crm_records'),
   'opportunity.created',{opportunity_id:OPP}),'CANONICAL_LOOKUP_FAILED');
 await rejected(()=>loadShadowCanonicalContext(db(model(),'crm_stripe_events'),
   'billing.paid_verified',{order_id:ORDER}),'CANONICAL_LOOKUP_FAILED');
});
Deno.test('Unknown lead intent and missing billing values remain unknown',async()=>{
 const ctx=await loadShadowCanonicalContext(db(),'lead.intake_received',{lead_id:OPP});
 assert(!Object.hasOwn(ctx,'opportunity')&&!Object.hasOwn(ctx,'billing'),'Invented context');
 assert(!Object.hasOwn(ctx,'lead'),'Unverified intent invented');
 assert(ctx.event.type==='lead.intake_received','Event type lost');
});
