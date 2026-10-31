/**
 * ORYNEO: side-effect-free, version-bound deterministic graph compiler and
 * segment interpreter. An interpreter outcome is never a dispatch capability.
 * Only trusted server loaders may supply canonical context and resume state.
 */
import {inspectServerGraph,type TrustedReferences,type GraphIssue} from './graphGuard.ts';
type Obj=Record<string,unknown>;
const object=(x:unknown):x is Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x);
type Node={id:string;type:string;config:Obj};
type Edge={source:string;source_port:string;target:string};
export type CompiledGraph={
 readonly graphHash:string;readonly graphId:string;readonly eventType:string;
 readonly nodes:ReadonlyMap<string,Node>;
 readonly next:ReadonlyMap<string,ReadonlyMap<string,string>>;
 readonly startNode:string;readonly dispatchAuthorized:false;
};
export type CompileResult=
 |{ok:true;compiled:CompiledGraph;issues:[];dispatchAuthorized:false}
 |{ok:false;issues:GraphIssue[];dispatchAuthorized:false};
export type SegmentTrace={nodeId:string;type:string;status:'evaluated'|'completed'|'waiting'|'requires_server_result';nextPort?:string};
export type SegmentResult={
 state:'completed'|'blocked'|'waiting'|'awaiting_server_outcome';
 dispatchAuthorized:false;graphHash:string;activationKey:string;
 trace:SegmentTrace[];plannedActions:{nodeId:string;type:string;actionKey:string}[];
 issues:GraphIssue[];resumeNodeId:string|null;
};
const fields=new Set([
 'opportunity.intent','opportunity.stage_id','opportunity.source',
 'opportunity.plan','opportunity.cycle','conversation.mode',
 'conversation.opted_out','conversation.consent_granted',
 'billing.status','billing.paid_verified','lead.intent','event.type'
]);
const actions=new Set([
 'whatsapp_template','whatsapp_reply','email','crm_stage_change',
 'crm_task','crm_update','human_handoff','notify'
]);
const pauses=new Set([
 'wait','intent_classifier','knowledge_lookup','ai_generate',...actions
]);
function canonical(x:unknown):string{
 if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';
 if(object(x))return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
 return JSON.stringify(x);
}
async function sha(s:string){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
export async function compileExecutionGraph(raw:unknown,refs:TrustedReferences):Promise<CompileResult>{
 const fail=(code:string,path:string):CompileResult=>({ok:false,issues:[{code,path}],dispatchAuthorized:false});
 if(!object(raw)||raw.status!=='published')return fail('IMMUTABLE_PUBLISHED_SNAPSHOT_REQUIRED','graph');
 const checked=inspectServerGraph({...raw,status:'draft'},refs);
 if(!checked.ok)return {ok:false,issues:checked.issues,dispatchAuthorized:false};
 const n=raw.nodes as Node[],e=raw.edges as Edge[];
 const start=n.find(x=>x.type==='trigger');
 if(!start)return fail('TRIGGER_REQUIRED','nodes');
 const nodes=new Map(n.map(x=>[x.id,{id:x.id,type:x.type,config:x.config}]));
 const next=new Map<string,Map<string,string>>();
 for(const edge of e){
  let ports=next.get(edge.source);
  if(!ports){ports=new Map();next.set(edge.source,ports);}
  ports.set(edge.source_port,edge.target);
 }
 const eventType=start.config.event_type;
 if(typeof eventType!=='string')return fail('EVENT_TYPE_INVALID','trigger');
 const graphHash=await sha(canonical(raw));
 return {ok:true,issues:[],dispatchAuthorized:false,compiled:{
  graphHash,graphId:String(raw.id),eventType,nodes,next,startNode:start.id,dispatchAuthorized:false
 }};
}
type Tri=true|false|'unknown';
function lookup(c:Obj,path:unknown):{found:boolean;value:unknown}{
 if(typeof path!=='string'||!fields.has(path))return {found:false,value:undefined};
 let v:unknown=c;
 for(const key of path.split('.')){
  if(!object(v)||!Object.prototype.hasOwnProperty.call(v,key))return {found:false,value:undefined};
  v=v[key];
 }
 if(object(v)||Array.isArray(v))return {found:false,value:undefined};
 return {found:true,value:v};
}
function rule(r:unknown,c:Obj,depth=0):Tri{
 if(depth>8||!object(r))return 'unknown';
 if(r.kind==='group'){
  if(!Array.isArray(r.rules)||r.rules.length===0||r.rules.length>32)return 'unknown';
  const values=r.rules.map(x=>rule(x,c,depth+1));
  if(r.op==='all')return values.includes(false)?false:values.includes('unknown')?'unknown':true;
  if(r.op==='any')return values.includes(true)?true:values.includes('unknown')?'unknown':false;
  return 'unknown';
 }
 const a=lookup(c,r.field);
 if(r.kind==='exists')return a.found;
 if(!a.found)return 'unknown';
 if(r.kind==='compare'){
  if(r.op==='eq')return a.value===r.value;
  if(r.op==='neq')return a.value!==r.value;
 }
 if(r.kind==='one_of'&&Array.isArray(r.values))return r.values.includes(a.value);
 return 'unknown';
}
export type SegmentInput={
 workspaceId:string;versionId:string;eventSource:string;eventId:string;
 eventType:string;context:Obj;
 /** Internal only: must be tied to an existing, fenced execution by the caller. */
 resume?:{nodeId:string;port:string};
};
const safeId=/^[a-zA-Z0-9_.:-]{1,128}$/;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function evaluateGraphSegment(plan:CompiledGraph,input:SegmentInput):Promise<SegmentResult>{
 const trace:SegmentTrace[]=[];
 const plannedActions:SegmentResult['plannedActions']=[];
 const issues:GraphIssue[]=[];
 const key=await sha(JSON.stringify([input.workspaceId,input.versionId,input.eventSource,input.eventId]));
 const result=(state:SegmentResult['state'],resumeNodeId:string|null=null):SegmentResult=>({
  state,dispatchAuthorized:false,graphHash:plan.graphHash,activationKey:key,
  trace,plannedActions,issues,resumeNodeId
 });
 const deny=(code:string,path:string)=>{issues.push({code,path});return result('blocked');};
 if(!uuid.test(input.workspaceId)||!uuid.test(input.versionId)||!safeId.test(input.eventId)
   ||!safeId.test(input.eventType)||!safeId.test(input.eventSource)
   ||input.eventType!==plan.eventType||!object(input.context)
   ||canonical(input.context).length>16384)return deny('ENVELOPE_INVALID','event');
 let nodeId=plan.startNode;
 if(input.resume){
  const prev=plan.nodes.get(input.resume.nodeId);
  if(!prev||!pauses.has(prev.type)||!['out','timeout','error','found','missing','uncertain'].includes(input.resume.port))
   return deny('RESUME_PORT_INVALID','resume');
  const target=plan.next.get(prev.id)?.get(input.resume.port);
  if(!target)return deny('RESUME_BRANCH_NOT_FOUND','resume');
  // A human takeover or opt-out always stops a suspended conversation.
  const opt=lookup(input.context,'conversation.opted_out');
  const mode=lookup(input.context,'conversation.mode');
  if(opt.value===true||mode.value==='human_locked'||mode.value==='review')
   return deny('CONVERSATION_HANDOFF_OR_OPTOUT','resume');
  nodeId=target;
 }
 for(let steps=0;steps<plan.nodes.size;steps++){
  const n=plan.nodes.get(nodeId);
  if(!n)return deny('NODE_MISSING','node:'+nodeId);
  if(n.type==='end'||n.type==='stop'){
   trace.push({nodeId,type:n.type,status:'completed'});
   return result('completed');
  }
  if(pauses.has(n.type)){
   if(actions.has(n.type)){
    plannedActions.push({nodeId,type:n.type,actionKey:await sha(JSON.stringify([key,nodeId,n.type]))});
   }
   const status=n.type==='wait'?'waiting':'requires_server_result';
   trace.push({nodeId,type:n.type,status});
   return result(n.type==='wait'?'waiting':'awaiting_server_outcome',nodeId);
  }
  let port='out';
  if(n.type==='condition'){
   const value=rule(n.config.rule,input.context);
   if(value==='unknown')return deny('CONDITION_CONTEXT_UNKNOWN','node:'+nodeId);
   port=value?'yes':'no';
  }
  if(n.type==='billing_read'){
   const status=lookup(input.context,'billing.status');
   if(!status.found||typeof status.value!=='string')
    return deny('BILLING_CONTEXT_NOT_VERIFIED','node:'+nodeId);
  }
  trace.push({nodeId,type:n.type,status:'evaluated',nextPort:port});
  const nextId=plan.next.get(nodeId)?.get(port);
  if(!nextId)return deny('NO_NEXT_EDGE','node:'+nodeId);
  nodeId=nextId;
 }
 return deny('SEGMENT_LIMIT','graph');
}
