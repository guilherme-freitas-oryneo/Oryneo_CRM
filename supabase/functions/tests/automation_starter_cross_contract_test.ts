import { STARTER_FLOWS,buildStarterFlow } from '../../../src/automation/starterFlows.ts';
import { buildSimulationCase, type SimulationCaseId } from '../../../src/automation/simulationCases.ts';
import { inspectServerGraph, type TrustedReferences } from '../automation-api/graphGuard.ts';
import { planServerShadow } from '../automation-api/shadowEngine.ts';

const check=(ok:boolean,why:string)=>{if(!ok)throw Error(why)};
const ids=()=>{let i=0;return()=>`00000000-0000-4000-8000-${(++i).toString(16).padStart(12,'0')}`;};
const refs:TrustedReferences={
 eventTypes:[
  'opportunity.created','conversation.inbound','checkout.started','billing.paid_verified',
  'opportunity.stage_changed','proposal.sent',
 ],
 templateIds:[],stageIds:[],knowledgeIds:[],dictionaryIds:[],
};
Deno.test('every approved ZIP starter compiles against actual SERVER graph validator',()=>{
 for(const starter of STARTER_FLOWS){
  const draft=buildStarterFlow(starter.id,ids());
  const verdict=inspectServerGraph(draft,refs);
  check(verdict.ok,starter.name+' invalid on server: '+JSON.stringify(verdict.issues));
  check(verdict.dispatchAuthorized===false,'Server allowed action from starter');
  check(draft.edges.length>0&&draft.status==='draft','Starter was published implicitly');
 }
});
Deno.test('shadow execution of all starter graphs is non-emitting and requires canonical inputs',async()=>{
 for(const starter of STARTER_FLOWS){
  const graph=buildStarterFlow(starter.id,ids());
  const published={...graph,status:'published' as const};
  const result=await planServerShadow(published,{
    workspaceId:'11111111-1111-4111-8111-111111111111',
    flowVersionId:'22222222-2222-4222-8222-222222222222',
    source:'crm',eventId:'qa.only.1',eventType:starter.event,
    context:{event:{type:starter.event}},
  },refs);
  check(result.shadowOnly&&!result.dispatchAuthorized,'Unexpected live send capability');
  check(result.plannedActions.length===0,'Starter planned external side effect');
  check(result.state==='blocked'||result.state==='completed'||result.state==='waiting',
    'Unexpected shadow state: '+result.state);
 }
});

Deno.test('canonical hypothetical simulation cases follow visible branches without an effect',async()=>{
 const cases:Array<[typeof STARTER_FLOWS[number]['id'],SimulationCaseId,string,string]>= [
  ['new_opportunity','opportunity_present','completed','end'],
  ['new_opportunity','unknown','completed','stop'],
  ['talk_to_us','sdr_active','completed','end'],
  ['talk_to_us','human_locked','completed','stop'],
  ['direct_checkout','payment_pending','completed','end'],
  ['direct_checkout','unknown','completed','stop'],
  ['payment_confirmed','payment_pending','completed','stop'],
  ['payment_confirmed','payment_verified','completed','end'],
  ['payment_confirmed','unknown','blocked',''],
  ['diagnosis','opportunity_present','completed','end'],
  ['proposal','opportunity_present','completed','end'],
  ['follow_up','sdr_active','waiting','wait'],
  ['follow_up','human_locked','completed','stop'],
  ['conversational_sdr','sdr_active','completed','end'],
  ['conversational_sdr','human_locked','completed','stop'],
 ];
 for(const [starterId,scenario,expectedState,terminalType] of cases){
  const starter=STARTER_FLOWS.find(item=>item.id===starterId)!;
  const graph=buildStarterFlow(starterId,ids());
  const context={...buildSimulationCase(scenario),event:{type:starter.event}};
  const result=await planServerShadow({...graph,status:'published'},{
   workspaceId:'11111111-1111-4111-8111-111111111111',
   flowVersionId:'22222222-2222-4222-8222-222222222222',
   source:starter.event.startsWith('conversation.')?'whatsapp':
     starter.event.startsWith('billing.')?'stripe':'crm',
   eventId:'qa.scenario.'+starterId+'-'+scenario,
   eventType:starter.event,context,
  },refs);
  check(result.state===expectedState,
   starterId+'/'+scenario+' state '+result.state+' expected '+expectedState+
   ' issues='+JSON.stringify(result.issues));
  check(!result.dispatchAuthorized&&result.plannedActions.length===0,
   'Hypothetical starter generated real action');
  if(terminalType)check(result.trace.at(-1)?.type===terminalType,
   'Visual terminal mismatch for '+starterId+'/'+scenario);
  check(result.trace.length<=graph.nodes.length,'Trace escaped graph');
 }
});
