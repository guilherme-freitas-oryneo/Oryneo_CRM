import {planServerShadow,planServerShadowCompiled} from '../automation-api/shadowEngine.ts';
import type {TrustedReferences} from '../automation-api/graphGuard.ts';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const refs:TrustedReferences={eventTypes:['opportunity.created'],stageIds:[],templateIds:[],knowledgeIds:[],dictionaryIds:[]};
const graph=()=>({
 id:id(1),name:'Versioned engine fixture',kind:'pipeline',status:'published',version:1,schema_version:'1.0.0',
 nodes:[
  {id:id(2),type:'trigger',label:'T',position:{x:0,y:0},config:{event_type:'opportunity.created'},ports:['out']},
  {id:id(3),type:'condition',label:'C',position:{x:1,y:1},config:{rule:{kind:'compare',field:'opportunity.intent',op:'eq',value:'conversation'}},ports:['in','yes','no']},
  {id:id(4),type:'end',label:'Y',position:{x:2,y:1},config:{},ports:['in']},
  {id:id(5),type:'stop',label:'N',position:{x:2,y:2},config:{},ports:['in']}],
 edges:[
  {id:id(6),source:id(2),source_port:'out',target:id(3),target_port:'in'},
  {id:id(7),source:id(3),source_port:'yes',target:id(4),target_port:'in'},
  {id:id(8),source:id(3),source_port:'no',target:id(5),target_port:'in'}]
});
const event=(intent:unknown)=>({workspaceId:id(10),flowVersionId:id(11),source:'crm',
 eventId:'evt.check',eventType:'opportunity.created',context:{opportunity:{intent}}});
function check(a:boolean,msg:string){if(!a)throw Error(msg);}
Deno.test('compiled interpreter matches previously validated shadow branches and activation keys',async()=>{
 for(const value of ['conversation','purchase',null]){
  const original=await planServerShadow(graph(),event(value),refs);
  const compiled=await planServerShadowCompiled(graph(),event(value),refs);
  check(original.state===compiled.state,'State differs '+value);
  check(original.activationKey===compiled.activationKey,'Activation identity changed '+value);
  check(JSON.stringify(original.trace)===JSON.stringify(compiled.trace),'Trace differs '+value);
  check(!compiled.dispatchAuthorized&&compiled.plannedActions.length===0,'Unexpected external effects');
 }
});
Deno.test('compiler rejects mutable graphs, stale events and missing context without side effects',async()=>{
 const a=graph();a.status='draft';
 const draft=await planServerShadowCompiled(a,event('conversation'),refs);
 check(draft.state==='blocked'&&draft.activationKey===null,'Draft allowed');
 const e={...event('conversation'),eventType:'billing.paid_verified'};
 const invalid=await planServerShadowCompiled(graph(),e,refs);
 check(invalid.state==='blocked','Mismatched event');
 const unknown=await planServerShadowCompiled(graph(),{...event('conversation'),context:{}},refs);
 check(unknown.state==='blocked','Missing canonical field accepted');
});
