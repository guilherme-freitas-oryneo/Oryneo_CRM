/**
 * Pure, non-emitting server shadow interpreter.
 * It cannot persist, send, change a stage, run billing or schedule timers.
 * A future worker must prove exactly-once ownership before using adapters.
 */
import { inspectServerGraph, type TrustedReferences } from './graphGuard.ts';

type Rec = Record<string, unknown>;
const obj=(v:unknown):v is Rec=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const eventId=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,128}$/.test(v);
type Tri=true|false|'unknown';
export type ShadowEnvelope={
  workspaceId:string;flowVersionId:string;source:string;eventId:string;
  eventType:string;context:Record<string,unknown>;
};
export type ShadowTrace={ nodeId:string;type:string;status:string;nextPort?:string };
export type ShadowResult={
  shadowOnly:true;dispatchAuthorized:false;state:'blocked'|'completed'|'awaiting_server_outcome'|'waiting';
  activationKey:string|null;trace:ShadowTrace[];
  plannedActions:{nodeId:string;type:string;actionKey:string}[];
  issues:{code:string;path:string}[];
};
const STOP_AT_SERVER=new Set([
  'intent_classifier','knowledge_lookup','ai_generate','wait',
  'whatsapp_template','whatsapp_reply','email','crm_stage_change','crm_task','crm_update',
  'human_handoff','notify',
]);
const EFFECT=new Set([
  'whatsapp_template','whatsapp_reply','email','crm_stage_change','crm_task','crm_update',
  'human_handoff','notify',
]);
const allowedPaths=new Set([
  'opportunity.intent','opportunity.stage_id','opportunity.source',
  'opportunity.plan','opportunity.cycle','conversation.mode',
  'conversation.opted_out','conversation.consent_granted',
  'billing.status','billing.paid_verified','lead.intent','event.type',
]);
function field(context:Rec,path:unknown):{found:boolean;value:unknown}{
  if(typeof path!=='string'||!allowedPaths.has(path))return {found:false,value:undefined};
  let value:unknown=context;
  for(const part of path.split('.')){
    if(!obj(value)||!Object.prototype.hasOwnProperty.call(value,part))return {found:false,value:undefined};
    value=value[part];
  }
  return {found:true,value};
}
function evaluate(rule:unknown,context:Rec):Tri{
  if(!obj(rule))return 'unknown';
  if(rule.kind==='group'&&Array.isArray(rule.rules)){
    const values:Tri[]=rule.rules.map(child=>evaluate(child,context));
    if(rule.op==='all')return values.includes(false)?false:values.includes('unknown')?'unknown':true;
    if(rule.op==='any')return values.includes(true)?true:values.includes('unknown')?'unknown':false;
    return 'unknown';
  }
  const actual=field(context,rule.field);
  if(rule.kind==='exists')return actual.found;
  if(!actual.found)return 'unknown';
  if(!['string','number','boolean'].includes(typeof actual.value)&&actual.value!==null)return 'unknown';
  if(rule.kind==='one_of'&&Array.isArray(rule.values))return rule.values.some(v=>v===actual.value);
  if(rule.kind==='compare') {
    if(rule.op==='eq')return rule.value===actual.value;
    if(rule.op==='neq')return rule.value!==actual.value;
  }
  return 'unknown';
}
async function digest(parts:string[]):Promise<string>{
  const hashed=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(hashed),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function planServerShadow(
  graph:unknown,event:unknown,refs:TrustedReferences,
):Promise<ShadowResult>{
  const trace:ShadowTrace[]=[];
  const plannedActions:ShadowResult['plannedActions']=[];
  const issues:ShadowResult['issues']=[];
  const rejected=(code:string,path:string):ShadowResult=>({
    shadowOnly:true,dispatchAuthorized:false,state:'blocked',
    activationKey:null,trace:[],plannedActions:[],issues:[{code,path}],
  });
  if(!obj(graph)||graph.status!=='published'||graph.schema_version!=='1.0.0')
    return rejected('IMMUTABLE_PUBLISHED_SNAPSHOT_REQUIRED','graph');
  const validation=inspectServerGraph({...graph,status:'draft'},refs);
  if(!validation.ok)return {
    shadowOnly:true,dispatchAuthorized:false,state:'blocked',
    activationKey:null,trace,plannedActions,issues:validation.issues,
  };
  if(!obj(event)||!uuid(event.workspaceId)||!uuid(event.flowVersionId)
    ||!eventId(event.eventId)||!eventId(event.eventType)
    ||!['crm','whatsapp','stripe','mail','landing'].includes(String(event.source))
    ||!obj(event.context)||JSON.stringify(event.context).length>16384)
    return rejected('ENVELOPE_INVALID','event');
  const env=event as ShadowEnvelope;
  const nodes=new Map((graph.nodes as Rec[]).map(n=>[String(n.id),n]));
  const outgoing=graph.edges as Rec[];
  const trigger=(graph.nodes as Rec[]).find(n=>n.type==='trigger');
  if(!trigger||!obj(trigger.config)||trigger.config.event_type!==env.eventType)
    return rejected('EVENT_TYPE_NOT_MATCHED','event.eventType');
  const activationKey=await digest([
    env.workspaceId,env.flowVersionId,env.source,env.eventId,
  ]);
  let current:Rec|undefined=trigger;
  for(let count=0;count<nodes.size&&current;count++){
    const nodeId=String(current.id),type=String(current.type);
    if(type==='end'||type==='stop'){
      trace.push({nodeId,type,status:'completed'});
      return {shadowOnly:true,dispatchAuthorized:false,state:'completed',
        activationKey,trace,plannedActions,issues};
    }
    if(STOP_AT_SERVER.has(type)){
      const actionKey=EFFECT.has(type)?await digest([activationKey,nodeId,type]):null;
      if(actionKey)plannedActions.push({nodeId,type,actionKey});
      trace.push({nodeId,type,status:type==='wait'?'waiting':'requires_server_result'});
      return {shadowOnly:true,dispatchAuthorized:false,
        state:type==='wait'?'waiting':'awaiting_server_outcome',
        activationKey,trace,plannedActions,issues};
    }
    let nextPort='out';
    if(type==='billing_read'){
      // Only the canonical server-hydrated billing context is observable.
      // This node NEVER infers payment verification from a paid status or text.
      const billing=field(env.context,'billing.status');
      if(!billing.found||typeof billing.value!=='string'){
        issues.push({code:'BILLING_CONTEXT_NOT_VERIFIED',path:'node:'+nodeId});
        return {shadowOnly:true,dispatchAuthorized:false,state:'blocked',
          activationKey,trace,plannedActions,issues};
      }
    }
    if(type==='condition'){
      const cfg=obj(current.config)?current.config:{};
      const result=evaluate(cfg.rule,env.context);
      if(result==='unknown'){
        issues.push({code:'CONDITION_CONTEXT_UNKNOWN',path:'node:'+nodeId});
        return {shadowOnly:true,dispatchAuthorized:false,state:'blocked',
          activationKey,trace,plannedActions,issues};
      }
      nextPort=result?'yes':'no';
    }
    trace.push({nodeId,type,status:'evaluated',nextPort});
    const edge=outgoing.find(e=>e.source===nodeId&&e.source_port===nextPort);
    if(!edge||!nodes.has(String(edge.target))){
      issues.push({code:'NO_NEXT_EDGE',path:'node:'+nodeId});
      return {shadowOnly:true,dispatchAuthorized:false,state:'blocked',
        activationKey,trace,plannedActions,issues};
    }
    current=nodes.get(String(edge.target));
  }
  issues.push({code:'TRACE_LIMIT','path':'graph'});
  return {shadowOnly:true,dispatchAuthorized:false,state:'blocked',
    activationKey,trace,plannedActions,issues};
}
