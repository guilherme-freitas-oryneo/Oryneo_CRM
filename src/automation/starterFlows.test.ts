import { describe,expect,it } from 'vitest';
import { buildStarterFlow,STARTER_FLOWS } from './starterFlows';
import { validateFlow,simulateFlow } from './flowDefinition';
import { NODE_REGISTRY } from './nodeRegistry';

const uuidFactory=()=>{let n=0;return ()=>`00000000-0000-4000-8000-${(++n).toString(16).padStart(12,'0')}`;};
describe('ORYNEO eight starter journeys',()=>{
 it('matches all eight ZIP starter names with no duplicates',()=>{
  expect(STARTER_FLOWS.map(x=>x.name)).toEqual([
   'Nova oportunidade','Quero conversar','Checkout direto',
   'Pagamento confirmado','Diagnóstico','Proposta','Follow-up','SDR conversacional',
  ]);
  expect(new Set(STARTER_FLOWS.map(x=>x.id)).size).toBe(8);
 });
 for(const preset of STARTER_FLOWS){
  it(`creates an editable, connected, strictly non-sending draft: ${preset.name}`,()=>{
   const graph=buildStarterFlow(preset.id,uuidFactory());
   expect(graph.status).toBe('draft');
   expect(graph.kind).toBe(preset.kind);
   expect(graph.nodes.find(n=>n.type==='trigger')?.config).toEqual({event_type:preset.event});
   expect(graph.metadata?.live_dispatch).toBe(false);
   expect(graph.metadata?.requires_business_approval).toBe(true);
   expect(validateFlow(graph)).toEqual({ok:true,issues:[]});
   expect(graph.nodes.filter(n=>NODE_REGISTRY[n.type].externalEffect)).toHaveLength(0);
   const allIds=[graph.id,...graph.nodes.map(n=>n.id),...graph.edges.map(e=>e.id)];
   expect(new Set(allIds).size).toBe(allIds.length);
   for(const edge of graph.edges){
    expect(graph.nodes.some(n=>n.id===edge.source&&n.ports.includes(edge.source_port))).toBe(true);
    expect(graph.nodes.some(n=>n.id===edge.target&&n.ports.includes(edge.target_port))).toBe(true);
   }
   const result=simulateFlow(graph,{event:{type:preset.event}});
   expect(result.dryRun).toBe(true);
  });
 }
 it('never invents a payment confirmation when constructing a purchase flow',()=>{
  const g=buildStarterFlow('payment_confirmed',uuidFactory());
  const check=g.nodes.find(n=>n.type==='condition');
  expect(check?.config.rule).toEqual({
   kind:'compare',field:'billing.paid_verified',op:'eq',value:true,
  });
  expect(g.nodes.some(n=>n.type==='crm_stage_change')).toBe(false);
 });
 it('follows explicit consent and cancel-on-reply for unattended follow-up',()=>{
  const g=buildStarterFlow('follow_up',uuidFactory());
  expect(g.nodes.find(n=>n.type==='condition')?.config.rule).toEqual({
   kind:'compare',field:'conversation.consent_granted',op:'eq',value:true,
  });
  expect(g.nodes.find(n=>n.type==='wait')?.config.cancel_on_reply).toBe(true);
  expect(g.edges.some(e=>e.source_port==='timeout')).toBe(true);
  expect(g.nodes.some(n=>n.type==='whatsapp_template'||n.type==='email')).toBe(false);
 });
 it('rejects unknown or duplicate draft IDs',()=>{
  expect(()=>buildStarterFlow('unknown' as never,uuidFactory())).toThrow('UNKNOWN_STARTER_FLOW');
  expect(()=>buildStarterFlow('new_opportunity',()=> '00000000-0000-4000-8000-000000000001'))
   .toThrow('INVALID_STARTER_ID');
 });
});
