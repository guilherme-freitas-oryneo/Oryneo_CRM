import { planServerShadow } from '../automation-api/shadowEngine.ts';
import type { TrustedReferences } from '../automation-api/graphGuard.ts';

const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const refs:TrustedReferences={eventTypes:['opportunity.created'],
  stageIds:[],templateIds:[],knowledgeIds:[],dictionaryIds:[]};
const check=(ok:boolean,msg:string)=>{if(!ok)throw new Error(msg)};
const graph=():any=>({
  schema_version:'1.0.0',status:'published',kind:'pipeline',id:id(1),
  name:'Simulação no servidor',version:1,
  nodes:[
    {id:id(2),type:'trigger',label:'Evento',position:{x:0,y:0},
      config:{event_type:'opportunity.created'},ports:['out']},
    {id:id(3),type:'condition',label:'Condição',position:{x:200,y:0},
      config:{rule:{kind:'compare',field:'opportunity.intent',op:'eq',value:'conversation'}},
      ports:['in','yes','no']},
    {id:id(4),type:'end',label:'Fim sim',position:{x:450,y:0},config:{},ports:['in']},
    {id:id(5),type:'stop',label:'Fim não',position:{x:450,y:200},config:{},ports:['in']},
  ],
  edges:[
    {id:id(6),source:id(2),source_port:'out',target:id(3),target_port:'in'},
    {id:id(7),source:id(3),source_port:'yes',target:id(4),target_port:'in'},
    {id:id(8),source:id(3),source_port:'no',target:id(5),target_port:'in'},
  ],
});
const event=(intent:unknown='conversation'):any=>({
  workspaceId:id(10),flowVersionId:id(11),source:'crm',eventId:'evt.42',
  eventType:'opportunity.created',context:{opportunity:{intent}},
});
Deno.test('shadow interpreter chooses the true and false branch without effects',async()=>{
  const yes=await planServerShadow(graph(),event('conversation'),refs);
  const no=await planServerShadow(graph(),event('contract'),refs);
  check(yes.state==='completed'&&no.state==='completed','both deterministic branches should complete');
  check(yes.trace.at(-1)?.nodeId===id(4),'yes branch incorrect');
  check(no.trace.at(-1)?.nodeId===id(5),'no branch incorrect');
  check(yes.shadowOnly&&!yes.dispatchAuthorized&&yes.plannedActions.length===0,'side effect detected');
});
Deno.test('missing or untrusted context fails closed',async()=>{
  const e=event();e.context={};
  const r=await planServerShadow(graph(),e,refs);
  check(r.state==='blocked'&&r.issues.some(x=>x.code==='CONDITION_CONTEXT_UNKNOWN'),'missing data must block');
});
Deno.test('unpublished and unknown events cannot be dispatched',async()=>{
  const g=graph();g.status='draft';
  const rejected=await planServerShadow(g,event(),refs);
  check(rejected.state==='blocked'&&!rejected.dispatchAuthorized,'draft execution rejected');
  const e=event();e.eventType='billing.unknown';
  const different=await planServerShadow(graph(),e,refs);
  check(different.state==='blocked'&&different.activationKey===null,'event mismatch rejected');
});
Deno.test('idempotent activation hashes are stable across repeated event delivery',async()=>{
  const x=await planServerShadow(graph(),event(),refs);
  const y=await planServerShadow(graph(),event(),refs);
  check(!!x.activationKey&&x.activationKey===y.activationKey,'activation key drift');
});
Deno.test('no immediate timer or external effect is possible in shadow mode',async()=>{
  const g=graph();
  g.nodes[1]={id:id(3),type:'wait',label:'Aguardar',position:{x:200,y:0},
    config:{duration_minutes:120,cancel_on_reply:true},ports:['in','out','timeout']};
  g.edges[1].source_port='out';g.edges[2].source_port='timeout';
  const r=await planServerShadow(g,event(),refs);
  check(r.state==='waiting'&&r.plannedActions.length===0&&!r.dispatchAuthorized,'durable timer was wrongly fired');
});
Deno.test('WhatsApp side effect is only a proposal with deterministic action key',async()=>{
  const g=graph();
  g.nodes[1]={id:id(3),type:'whatsapp_template',label:'Modelo',position:{x:200,y:0},
    config:{template_registry_id:id(30),locale:'pt_BR'},ports:['in','out','error']};
  g.edges[1].source_port='out';g.edges[2].source_port='error';
  const authorizedRefs={...refs,templateIds:[id(30)]};
  const first=await planServerShadow(g,event(),authorizedRefs);
  const second=await planServerShadow(g,event(),authorizedRefs);
  check(first.state==='awaiting_server_outcome'&&!first.dispatchAuthorized,'provider action was triggered');
  check(first.plannedActions.length===1&&first.plannedActions[0].actionKey===second.plannedActions[0].actionKey,'action key should be stable');
  const unverified=await planServerShadow(g,event(),refs);
  check(unverified.state==='blocked'&&unverified.plannedActions.length===0,'unapproved template was planned');
});
