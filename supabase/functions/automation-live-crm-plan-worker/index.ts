/**
 * ORYNEO Macro 6 — live CRM event compiler (opt-in only).
 * In production this worker starts OFF. Before any activation, prove legacy
 * CRM dispatcher paused, obtain release attestation and initialize the
 * journal cursor while the runtime is stopped. This worker never sends
 * messages or handles payment; it writes only CRM-scoped durable action plans.
 */
import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
import {planServerShadowCompiled} from '../automation-api/shadowEngine.ts';
import {loadTrustedReferences} from '../automation-api/trustedReferences.ts';
import {loadShadowCanonicalContext} from '../automation-api/shadowContext.ts';
import {workerIsConfigured,validWorkerToken} from '../automation-shadow-worker/workerGuards.ts';

const projectUrl=Deno.env.get('SUPABASE_URL')||'';
const roleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const workspaceId=Deno.env.get('AUTOMATION_LIVE_CRM_WORKSPACE_ID')||'';
const secret=Deno.env.get('AUTOMATION_LIVE_CRM_SECRET')||'';
const enabled=Deno.env.get('AUTOMATION_LIVE_CRM_PLANNER_ENABLED')==='true';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'},
});
type Event={inbox_id:string;source:string;event_id:string;event_type:string;
 context_refs:Record<string,unknown>;lease_token:string};
type Flow={id:string;published_version_id:string;enabled:boolean};
type Version={id:string;graph_json:unknown;status:string};
const failureCode=(error:unknown):string=>{
 const code=error instanceof Error?error.message:'';
 if(code==='LIVE_CONTEXT_UNAVAILABLE')return code;
 if(code==='LIVE_VERSION_DRIFT')return code;
 if(code==='LIVE_GRAPH_REJECTED')return code;
 return 'LIVE_COMMIT_UNAVAILABLE';
};

Deno.serve(async request=>{
 if(request.method!=='POST')return response({error:'Method not allowed'},405);
 if(!workerIsConfigured({enabled,projectUrl,serviceRole:roleKey,workspaceId,workerSecret:secret}))
  return response({error:'CRM planner disabled'},503);
 if(!validWorkerToken(request.headers.get('x-oryneo-live-crm-secret')||'',secret))
  return response({error:'Access denied'},401);
 const db=createClient(projectUrl,roleKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const [setting,owner]=await Promise.all([
  db.from('automation_runtime_settings').select('mode,emergency_stop')
   .eq('workspace_id',workspaceId).maybeSingle(),
  db.rpc('automation_channel_cutover_preflight',{p_workspace_id:workspaceId,p_channel:'crm'}),
 ]);
 if(setting.error||setting.data?.mode!=='live'||setting.data.emergency_stop!==false
   ||owner.error||owner.data?.eligible!==true||owner.data?.dispatchAuthorized!==false)
  return response({ok:true,processed:0,disabled:true});
 const refs=await loadTrustedReferences(db,workspaceId).catch(()=>null);
 if(!refs)return response({error:'Canonical metadata unavailable'},503);
 const batch=await db.rpc('automation_live_crm_poll',{p_workspace_id:workspaceId,p_limit:20});
 if(batch.error||batch.data?.dispatchAuthorized!==false)
  return response({error:'Canonical source cursor unavailable'},503);
 const claimed=await db.rpc('automation_live_crm_claim',{p_workspace_id:workspaceId,p_limit:5});
 if(claimed.error||!Array.isArray(claimed.data))
  return response({error:'CRM inbox claim unavailable'},503);
 let processed=0,unresolved=0,quarantined=0;
 for(const event of claimed.data as Event[]){
  try{
   const gate=await db.rpc('automation_channel_cutover_preflight',{
     p_workspace_id:workspaceId,p_channel:'crm',
   });
   if(gate.error||gate.data?.eligible!==true)throw Error('LIVE_VERSION_DRIFT');
   const flows=await db.from('automation_flows')
    .select('id,published_version_id,enabled')
    .eq('workspace_id',workspaceId).eq('enabled',true)
    .not('published_version_id','is',null).limit(21);
   if(flows.error||!flows.data||flows.data.length>20)throw Error('LIVE_VERSION_DRIFT');
   const ids=(flows.data as Flow[]).map(f=>f.published_version_id);
   const versions=ids.length?await db.from('automation_flow_versions')
    .select('id,graph_json,status').eq('workspace_id',workspaceId)
    .in('id',ids).eq('status','published')
    :{data:[] as Version[],error:null};
   if(versions.error||versions.data?.length!==ids.length)throw Error('LIVE_VERSION_DRIFT');
   const applicable=(versions.data as Version[]).filter(v=>{
    const g=v.graph_json as {nodes?:Array<{type?:string;config?:{event_type?:string}}>};
    return Array.isArray(g?.nodes)&&g.nodes.some(n=>
     n.type==='trigger'&&n.config?.event_type===event.event_type);
   });
   const canonical=await loadShadowCanonicalContext(db,event.event_type,event.context_refs)
    .catch(()=>{throw Error('LIVE_CONTEXT_UNAVAILABLE');});
   const plans=[];
   for(const version of applicable){
    const decision=await planServerShadowCompiled(version.graph_json,{
     workspaceId,flowVersionId:version.id,
     source:event.source,eventId:event.event_id,eventType:event.event_type,
     context:canonical,
    },refs).catch(()=>{throw Error('LIVE_GRAPH_REJECTED');});
    // Only a CRM task or stage change can reach the action outbox.
    // All message, e-mail, billing, AI and ambiguous wait branches fail closed.
    if(decision.plannedActions.some(x=>
      x.type!=='crm_stage_change'&&x.type!=='crm_task'))
      throw Error('LIVE_GRAPH_REJECTED');
    if(!decision.activationKey||decision.state==='blocked')
      throw Error('LIVE_GRAPH_REJECTED');
    plans.push({flowVersionId:version.id,decision});
   }
   const committed=await db.rpc('automation_live_crm_finish',{
    p_workspace_id:workspaceId,p_inbox_id:event.inbox_id,
    p_lease_token:event.lease_token,p_plans:plans,
   });
   if(committed.error||committed.data?.ok!==true
     ||committed.data?.dispatchAuthorized!==false
     ||committed.data?.externalMessagesSent!==0)
    throw Error('LIVE_COMMIT_UNAVAILABLE');
   processed++;
  }catch(error){
   try{
    const fail=await db.rpc('automation_live_crm_fail',{
     p_workspace_id:workspaceId,p_inbox_id:event.inbox_id,
     p_lease_token:event.lease_token,p_code:failureCode(error),
    });
    if(fail.error)unresolved++;
    else if(fail.data==='quarantined')quarantined++;
   }catch{unresolved++;}
  }
 }
 return response({ok:true,source:'canonical_crm',processed,unresolved,
  quarantined,externalMessagesSent:0,paymentsCreated:0,
  dispatchAuthorized:false});
});
