/**
 * ORYNEO shadow-only durable worker. NEVER DEPLOY OR SCHEDULE before the
 * isolated SQL migration, verified secrets and environment gates are approved.
 *
 * No Meta, e-mail, Stripe, CRM mutation or provider calls exist in this module.
 * It acknowledges plans as metadata with all action outbox rows blocked.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { planServerShadow } from '../automation-api/shadowEngine.ts';
import { loadTrustedReferences } from '../automation-api/trustedReferences.ts';

const projectUrl=Deno.env.get('SUPABASE_URL')||'';
const serviceRole=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const workspaceId=Deno.env.get('AUTOMATION_SHADOW_WORKSPACE_ID')||'';
const workerSecret=Deno.env.get('AUTOMATION_SHADOW_WORKER_SECRET')||'';
const enabled=Deno.env.get('AUTOMATION_SHADOW_WORKER_ENABLED')==='true';
const db=createClient(projectUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
});
function validToken(supplied:string,expected:string):boolean{
  if(expected.length<32||supplied.length!==expected.length)return false;
  let delta=0;
  for(let i=0;i<expected.length;i++)delta|=expected.charCodeAt(i)^supplied.charCodeAt(i);
  return delta===0;
}
type Claimed={
  inbox_id:string;source:string;event_id:string;event_type:string;
  context_refs:Record<string,unknown>;lease_token:string;attempt:number;
};
type FlowRow={id:string;published_version_id:string;enabled:boolean};
type VersionRow={id:string;graph_json:unknown;status:string};

Deno.serve(async request=>{
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(!enabled||!projectUrl||!serviceRole||!UUID.test(workspaceId)||workerSecret.length<32)
    return json({error:'Shadow worker disabled'},503);
  if(!validToken(request.headers.get('x-oryneo-shadow-secret')||'',workerSecret))
    return json({error:'Access denied'},401);

  const settings=await db.from('automation_runtime_settings')
    .select('mode,emergency_stop').eq('workspace_id',workspaceId).maybeSingle();
  if(settings.error||settings.data?.mode!=='shadow'||settings.data.emergency_stop!==false)
    return json({ok:true,processed:0,disabled:true});

  const refs=await loadTrustedReferences(db,workspaceId).catch(()=>null);
  if(!refs)return json({error:'Canonical references not available'},503);

  // The cursor must be initialized deliberately under the disabled runtime.
  // Missing cursor or any DB error stops the worker; never infer an offset.
  const ingested=await db.rpc('automation_shadow_ingest_crm',{
    p_workspace_id:workspaceId,p_batch_limit:50,
  });
  if(ingested.error)return json({error:'Unable to ingest canonical CRM events'},503);
  const ingestedWa=await db.rpc('automation_shadow_ingest_whatsapp',{
    p_workspace_id:workspaceId,p_batch_limit:50,
  });
  if(ingestedWa.error)return json({error:'Unable to ingest canonical WhatsApp events'},503);

  const recovered=await db.rpc('automation_shadow_recover',{p_workspace_id:workspaceId});
  if(recovered.error)return json({error:'Unable to reconcile shadow leases'},503);
  const claimed=await db.rpc('automation_shadow_claim',{
    p_workspace_id:workspaceId,p_batch_limit:5,
  });
  if(claimed.error||!Array.isArray(claimed.data))
    return json({error:'Unable to claim shadow events'},503);

  let processed=0,unresolved=0;
  for(const event of claimed.data as Claimed[]){
    try{
      // Revalidate stop switch on each event, not only at start of request.
      const gate=await db.from('automation_runtime_settings')
        .select('mode,emergency_stop').eq('workspace_id',workspaceId).maybeSingle();
      if(gate.error||gate.data?.mode!=='shadow'||gate.data.emergency_stop!==false){
        unresolved++;break;
      }
      const flows=await db.from('automation_flows')
        .select('id,published_version_id,enabled')
        .eq('workspace_id',workspaceId).eq('enabled',false)
        .not('published_version_id','is',null).limit(100);
      if(flows.error)throw new Error('SHADOW_FLOWS_UNAVAILABLE');
      const ids=(flows.data as FlowRow[]||[])
        .map(f=>f.published_version_id).filter(Boolean);
      if(ids.length>20)throw new Error('SHADOW_FLOW_LIMIT');
      const versions=ids.length
        ?await db.from('automation_flow_versions')
          .select('id,graph_json,status').eq('workspace_id',workspaceId)
          .in('id',ids).eq('status','published')
        :{data:[] as VersionRow[],error:null};
      if(versions.error)throw new Error('SHADOW_VERSIONS_UNAVAILABLE');
      const candidates=(versions.data as VersionRow[]||[]).filter(v=>{
        if(!v.graph_json||typeof v.graph_json!=='object')return false;
        const g=v.graph_json as {nodes?:Array<{type?:unknown;config?:{event_type?:unknown}}>};
        return Array.isArray(g.nodes)&&g.nodes.some(n=>
          n.type==='trigger'&&n.config?.event_type===event.event_type);
      });
      if(candidates.length>20)throw new Error('SHADOW_FLOW_LIMIT');
      const plans=[];
      for(const version of candidates){
        const decision=await planServerShadow(version.graph_json,{
          workspaceId,flowVersionId:version.id,
          source:event.source,eventId:event.event_id,
          eventType:event.event_type,
          // References contain IDs only. Verified business context requires a
          // separate canonical adapter; never infer payment or consent.
          context:{event:{type:event.event_type}},
        },refs);
        plans.push({flowVersionId:version.id,decision});
      }
      const acknowledged=await db.rpc('automation_shadow_finish',{
        p_workspace_id:workspaceId,p_inbox_id:event.inbox_id,
        p_lease_token:event.lease_token,p_plans:plans,
      });
      if(acknowledged.error)throw new Error('SHADOW_ACK_FAILED');
      processed++;
    }catch{
      // Do not acknowledge unknown results or invent a retry. The lease
      // expires, and the DB claims at most five times before quarantining.
      unresolved++;
    }
  }
  return json({
    ok:true,shadowOnly:true,dispatchAuthorized:false,
    processed,unresolved,recovered:recovered.data||0,
    crmScanned:Number(ingested.data?.scanned||0),crmInserted:Number(ingested.data?.inserted||0),
    waScanned:Number(ingestedWa.data?.scanned||0),waInserted:Number(ingestedWa.data?.inserted||0),
  });
});
