import {compileExecutionGraph,evaluateGraphSegment} from '../automation-api/executionKernel.ts';
import type {TrustedReferences} from '../automation-api/graphGuard.ts';
const uuid=(i:number)=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
const refs:TrustedReferences={eventTypes:['opportunity.created'],stageIds:[],templateIds:[],knowledgeIds:[],dictionaryIds:[]};
function assert(x:boolean,s:string){if(!x)throw Error(s);}
const graph=():any=>({
 id:uuid(1),name:'Worker compiled engine',kind:'pipeline',status:'published',version:1,schema_version:'1.0.0',
 nodes:[
  {id:uuid(2),type:'trigger',label:'Start',position:{x:0,y:0},config:{event_type:'opportunity.created'},ports:['out']},
  {id:uuid(3),type:'condition',label:'Gate',position:{x:10,y:0},config:{rule:{kind:'compare',field:'opportunity.intent',op:'eq',value:'conversation'}},ports:['in','yes','no']},
  {id:uuid(4),type:'wait',label:'Wait',position:{x:20,y:0},config:{duration_minutes:10,cancel_on_reply:false},ports:['in','out','timeout']},
  {id:uuid(5),type:'end',label:'Finished',position:{x:40,y:0},config:{},ports:['in']},
  {id:uuid(6),type:'stop',label:'Stopped',position:{x:30,y:50},config:{},ports:['in']},
  {id:uuid(7),type:'end',label:'Timed out',position:{x:40,y:50},config:{},ports:['in']}
 ],
 edges:[
  {id:uuid(20),source:uuid(2),source_port:'out',target:uuid(3),target_port:'in'},
  {id:uuid(21),source:uuid(3),source_port:'yes',target:uuid(4),target_port:'in'},
  {id:uuid(22),source:uuid(3),source_port:'no',target:uuid(6),target_port:'in'},
  {id:uuid(23),source:uuid(4),source_port:'out',target:uuid(5),target_port:'in'},
  {id:uuid(24),source:uuid(4),source_port:'timeout',target:uuid(7),target_port:'in'}
 ]
});
const input=()=>({workspaceId:uuid(40),versionId:uuid(41),eventSource:'crm',eventId:'evt.10',eventType:'opportunity.created',context:{opportunity:{intent:'conversation'}}});
Deno.test('compiler rejects drafts, unknown references and preserves stable graph hash',async()=>{
 const g=graph();const a=await compileExecutionGraph(g,refs);
 assert(a.ok,'Valid graph rejected: '+JSON.stringify(a));
 if(!a.ok)return;
 const b=await compileExecutionGraph({...g,nodes:[...g.nodes].reverse(),edges:[...g.edges].reverse()},refs);
 assert(b.ok,'Second graph rejected');
 const same=await compileExecutionGraph(structuredClone(g),refs);
 assert(same.ok&&same.compiled.graphHash===a.compiled.graphHash,'Same snapshot got different hash');
 assert(!((await compileExecutionGraph({...g,status:'draft'},refs)).ok),'Draft compiled');
});
Deno.test('branch, wait and resume outcome follow immutable edges with no effects',async()=>{
 const c=await compileExecutionGraph(graph(),refs);if(!c.ok)throw Error('not compiled');
 const start=await evaluateGraphSegment(c.compiled,input());
 assert(start.state==='waiting'&&start.trace.map(x=>x.nodeId).join(',')===[uuid(2),uuid(3),uuid(4)].join(','),'Wrong waiting segment');
 const after=await evaluateGraphSegment(c.compiled,{...input(),resume:{nodeId:uuid(4),port:'out'}});
 assert(after.state==='completed'&&after.trace.at(-1)?.nodeId===uuid(5),'Wrong resume');
 const timeout=await evaluateGraphSegment(c.compiled,{...input(),resume:{nodeId:uuid(4),port:'timeout'}});
 assert(timeout.state==='completed'&&timeout.trace.at(-1)?.nodeId===uuid(7),'Timeout routing');
 const neg=await evaluateGraphSegment(c.compiled,{...input(),context:{opportunity:{intent:'none'}}});
 assert(neg.state==='completed'&&neg.trace.at(-1)?.nodeId===uuid(6),'False branch');
 for(const p of [start,after,timeout,neg])assert(!p.dispatchAuthorized&&p.plannedActions.length===0,'Unexpected dispatch');
});
Deno.test('resumption with opt-out, invalid port, missing context and spoofed input fails closed',async()=>{
 const c=await compileExecutionGraph(graph(),refs);if(!c.ok)throw Error('not compiled');
 const stopped=await evaluateGraphSegment(c.compiled,{...input(),resume:{nodeId:uuid(4),port:'out'},context:{conversation:{opted_out:true}}});
 assert(stopped.state==='blocked'&&stopped.issues[0].code==='CONVERSATION_HANDOFF_OR_OPTOUT','Opt-out ignored');
 const bad=await evaluateGraphSegment(c.compiled,{...input(),resume:{nodeId:uuid(4),port:'arbitrary'}});
 assert(bad.state==='blocked','Untrusted port accepted');
 const missing=await evaluateGraphSegment(c.compiled,{...input(),context:{}});
 assert(missing.state==='blocked'&&missing.issues[0].code==='CONDITION_CONTEXT_UNKNOWN','Unknown was true');
 const fake=await evaluateGraphSegment(c.compiled,{...input(),eventType:'billing.paid_verified'});
 assert(fake.state==='blocked'&&fake.trace.length===0,'Spoofed event accepted');
});
Deno.test('dangerous unverified action cannot compile, even with a renderable edge',async()=>{
 const g=graph();g.nodes[2].type='email';g.nodes[2].config={};g.nodes[2].ports=['in','out','error'];
 g.edges[4].source_port='error';
 assert(!(await compileExecutionGraph(g,refs)).ok,'Unreviewed email adapter compiled');
});
