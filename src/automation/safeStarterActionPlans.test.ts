import {describe,expect,it} from 'vitest';
import {buildCrmReviewStarter} from './safeStarterActionPlans';
import {STARTER_FLOWS,buildStarterFlow} from './starterFlows';
import {simulateFlow,validateFlow} from './flowDefinition';

const nextIds=()=>{
 let n=0;
 return ()=>`00000000-0000-4000-8000-${(++n).toString(16).padStart(12,'0')}`;
};

describe('opt-in CRM review starting points',()=>{
 it('preserves the original zero-action drafts',()=>{
  for(const preset of STARTER_FLOWS){
   const original=buildStarterFlow(preset.id,nextIds());
   expect(original.nodes.some(n=>n.type==='crm_task')).toBe(false);
   expect(original.metadata?.live_dispatch).toBe(false);
  }
 });
 for(const preset of STARTER_FLOWS){
  it(`adds a gated internal review to ${preset.id}, without external effects`,()=>{
   const graph=buildCrmReviewStarter(preset.id,nextIds());
   expect(graph.status).toBe('draft');
   expect(graph.metadata?.draft_variant).toBe('crm_review_only');
   expect(graph.metadata?.live_dispatch).toBe(false);
   expect(graph.metadata?.external_transport_allowed).toBe(false);
   expect(graph.nodes.filter(n=>n.type==='crm_task')).toHaveLength(1);
   expect(graph.nodes.some(n=>['whatsapp_template','whatsapp_reply','email','crm_stage_change','billing_read','ai_generate'].includes(n.type))).toBe(false);
   expect(validateFlow(graph)).toEqual({ok:true,issues:[]});
   const ids=[graph.id,...graph.nodes.map(n=>n.id),...graph.edges.map(e=>e.id)];
   expect(new Set(ids).size).toBe(ids.length);
  });
 }
 it('never infers paid from checkout and never skips the verified-payment condition',()=>{
  const checkout=buildCrmReviewStarter('direct_checkout',nextIds());
  const payment=buildCrmReviewStarter('payment_confirmed',nextIds());
  expect(checkout.nodes.find(n=>n.type==='condition')?.config.rule).toEqual({kind:'exists',field:'billing.status'});
  expect(payment.nodes.find(n=>n.type==='condition')?.config.rule).toEqual({kind:'compare',field:'billing.paid_verified',op:'eq',value:true});
  expect(payment.metadata?.source_payment_proof_required).toBe(true);
  const refused=simulateFlow(payment,{
   eventType:'billing.paid_verified',context:{billing:{paid_verified:false}},
  });
  expect(refused.trace.some(t=>t.type==='crm_task')).toBe(false);
  const permitted=simulateFlow(payment,{
   eventType:'billing.paid_verified',context:{billing:{paid_verified:true}},
  });
  expect(permitted.trace.some(t=>t.type==='crm_task'&&t.status==='planned')).toBe(true);
  expect(permitted.dryRun).toBe(true);
 });
 it('preserves wait cancellation and never sends follow-ups after a timeout',()=>{
  const graph=buildCrmReviewStarter('follow_up',nextIds());
  const wait=graph.nodes.find(n=>n.type==='wait');
  expect(wait?.config.cancel_on_reply).toBe(true);
  expect(graph.edges.some(e=>e.source===wait?.id&&e.source_port==='timeout'
   &&graph.nodes.some(n=>n.type==='stop'&&n.id===e.target))).toBe(true);
  const preview=simulateFlow(graph,{
   eventType:'conversation.inbound',context:{conversation:{consent_granted:true}},
  });
  expect(preview.trace.at(-1)?.status).toBe('waiting');
  expect(preview.trace.some(t=>t.type==='crm_task')).toBe(false);
 });
 it('fails closed on bad or duplicated generated IDs',()=>{
  expect(()=>buildCrmReviewStarter('new_opportunity',()=> '00000000-0000-4000-8000-000000000001')).toThrow();
  let n=0;
  expect(()=>buildCrmReviewStarter('new_opportunity',()=>{
   n++;return n<8?`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`:
    '00000000-0000-4000-8000-000000000001';
  })).toThrow('INVALID_REVIEW_STARTER_ID');
 });
});
