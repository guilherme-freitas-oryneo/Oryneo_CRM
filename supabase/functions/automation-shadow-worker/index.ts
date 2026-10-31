/**
 * ORYNEO shadow-only durable worker. NEVER DEPLOY OR SCHEDULE before the
 * isolated SQL migration, verified secrets and environment gates are approved.
 *
 * No Meta, e-mail, Stripe, CRM mutation or provider calls exist in this module.
 * It acknowledges plans as metadata with all action outbox rows blocked.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { planServerShadowCompiled } from '../automation-api/shadowEngine.ts';
import { loadTrustedReferences } from '../automation-api/trustedReferences.ts';
import { loadShadowCanonicalContext } from '../automation-api/shadowContext.ts';
import { isCanonicalUuid, validWorkerToken, workerIsConfigured } from './workerGuards.ts';
import { shadowFailureCode } from './failurePolicy.ts';

const projectUrl=Deno.env.get('SUPABASE_URL')||'';
const serviceRole=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const workspaceId=Deno.env.get('AUTOMATION_SHADOW_WORKSPACE_ID')||'';
const workerSecret=Deno.env.get('AUTOMATION_SHADOW_WORKER_SECRET')||'';
const enabled=Deno.env.get('AUTOMATION_SHADOW_WORKER_ENABLED')==='true';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
});
type Claimed={
  inbox_id:string;source:string;event_id:string;event_type:string;
  context_refs:Record<string,unknown>;lease_token:string;attempt:number;
};
type FlowRow={id:string;published_version_id:string;enabled:boolean};
type VersionRow={id:string;graph_json:unknown;status:string};

Deno.serve(async request=>{
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(!workerIsConfigured({enabled,projectUrl,serviceRole,workspaceId,workerSecret}))
    return json({error:'Shadow worker disabled'},503);
  if(!validWorkerToken(request.headers.get('x-oryneo-shadow-secret')||'',workerSecret))
    return json({error:'Access denied'},401);

  // Client creation happens ONLY after all configuration/secret gates pass.
  // Missing hosted secrets cannot crash the module at import time.
  const db=createClient(projectUrl,serviceRole,{
    auth:{persistSession:false,autoRefreshToken:false},
  });
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

  // Macroetapa 3: all commercial sources are canonical, cursor-bound and
  // NON-EMITTING. This RPC exists only after its reviewed DB migration.
  // Missing cursor/schema fails closed instead of silently dropping events.
  const commercialStreams=['intake','checkout','billing','mail','delivery','proposal','meeting'] as const;
  for(const stream of commercialStreams){
    const mirrored=await db.rpc('automation_commercial_shadow_ingest',{
      p_workspace_id:workspaceId,p_stream:stream,p_limit:20,
    });
    if(mirrored.error)return json({
      error:'Commercial shadow adapter unavailable',source:stream,processed:0,
    },503);
    if(mirrored.data?.dispatchAuthorized!==false||mirrored.data?.shadowOnly!==true)
      return json({error:'Commercial adapter returned non-shadow mode',processed:0},503);
  }

  const recovered=await db.rpc('automation_shadow_recover',{p_workspace_id:workspaceId});
  if(recovered.error)return json({error:'Unable to reconcile shadow leases'},503);
  const claimed=await db.rpc('automation_shadow_claim',{
    p_workspace_id:workspaceId,p_batch_limit:5,
  });
  if(claimed.error||!Array.isArray(claimed.data))
    return json({error:'Unable to claim shadow events'},503);

  let processed=0,unresolved=0,failedRecorded=0,quarantined=0;
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
      const context=await loadShadowCanonicalContext(db,event.event_type,event.context_refs)
        .catch(()=>{throw new Error('SHADOW_CONTEXT_UNAVAILABLE');});
      // New canonical inbound activity cancels older shadow waits immediately.
      // The database independently verifies an actual inbound journal entry,
      // rejecting fabricated event text, reactions or client-provided claims.
      if(event.event_type==='conversation.inbound'){
        const id=event.context_refs.conversation_id;
        if(!isCanonicalUuid(id))throw new Error('WAIT_CONVERSATION_REQUIRED');
        const cancelled=await db.rpc('automation_wait_shadow_cancel_reply',{
          p_workspace_id:workspaceId,p_conversation_id:id,
        });
        if(cancelled.error)throw new Error('WAIT_CANCEL_UNAVAILABLE');
      }
      const plans=[];
      for(const version of candidates){
        const decision=await planServerShadowCompiled(version.graph_json,{
          workspaceId,flowVersionId:version.id,
          source:event.source,eventId:event.event_id,
          eventType:event.event_type,
          // Context is canonical, read-only, and excludes personal data.
          context,
        },refs).catch(()=>{throw new Error('SHADOW_PLANNER_FAILED');});
        plans.push({flowVersionId:version.id,decision});
      }
      const acknowledged=await db.rpc('automation_shadow_finish',{
        p_workspace_id:workspaceId,p_inbox_id:event.inbox_id,
        p_lease_token:event.lease_token,p_plans:plans,
      });
      if(acknowledged.error)throw new Error('SHADOW_ACK_FAILED');
      processed++;
    }catch(error){
      // Never leak provider errors or personal data. A fixed reason code and
      // fencing token let the database schedule bounded retries and quarantine.
      // RPC failure leaves the lease untouched for the original recovery path.
      try {
        const failure=await db.rpc('automation_shadow_fail',{
          p_workspace_id:workspaceId,p_inbox_id:event.inbox_id,
          p_lease_token:event.lease_token,p_error_code:shadowFailureCode(error),
        });
        if(failure.error)unresolved++;
        else {
          failedRecorded++;
          if(failure.data==='quarantined')quarantined++;
        }
      } catch { unresolved++; }
    }
  }
  // Due shadow timers are resumed from immutable snapshots; never send or mutate CRM.
  const guarded=await db.rpc('automation_wait_shadow_reconcile_policy',{
    p_workspace_id:workspaceId,p_limit:50,
  });
  if(guarded.error)return json({error:'Shadow stop policy unavailable',processed,unresolved},503);
  const due=await db.rpc('automation_wait_shadow_poll',{
    p_workspace_id:workspaceId,p_limit:10,
  });
  if(due.error||!Array.isArray(due.data))
    return json({error:'Shadow timer reconciliation unavailable',processed,unresolved},503);
  // Poll sets due state idempotently. A crash between poll and resume cannot
  // lose the timer: the due rows remain durable until resumed or quarantined.
  const dueRows=await db.from('automation_wait_timers')
    .select('id,execution_id,node_id')
    .eq('workspace_id',workspaceId).eq('state','due')
    .is('resumed_at',null).lte('resume_next_at',new Date().toISOString())
    .order('due_at',{ascending:true}).limit(10);
  if(dueRows.error)return json({error:'Shadow continuation index unavailable',processed,unresolved},503);
  let resumedTimers=0,resumeRetries=0,resumeQuarantined=0;
  for(const timer of dueRows.data||[]){
    let failureCode='SHADOW_RESUME_UNAVAILABLE';
    try {
      // Reconcile the canonical conversation AFTER the timer became due.
      // This closes the gap between polling and planning a continuation.
      const guard=await db.rpc('automation_wait_shadow_due_policy',{
        p_workspace_id:workspaceId,p_wait_id:timer.id,
      });
      if(guard.error)throw new Error('SHADOW_RESUME_UNAVAILABLE');
      if(guard.data==='cancelled'||guard.data==='not_due')continue;
      if(guard.data==='runtime_stopped')break;
      if(guard.data!=='ready')throw new Error('SHADOW_RESUME_UNAVAILABLE');
      const gate=await db.from('automation_runtime_settings')
        .select('mode,emergency_stop').eq('workspace_id',workspaceId).maybeSingle();
      if(gate.error||gate.data?.mode!=='shadow'||gate.data.emergency_stop!==false)
        break;
      const execution=await db.from('automation_executions')
        .select('flow_version_id,inbox_id,state')
        .eq('workspace_id',workspaceId).eq('id',timer.execution_id).maybeSingle();
      if(execution.error||execution.data?.state!=='shadow')
        throw new Error('SHADOW_RESUME_UNAVAILABLE');
      const version=await db.from('automation_flow_versions')
        .select('graph_json,status')
        .eq('workspace_id',workspaceId).eq('id',execution.data.flow_version_id).maybeSingle();
      if(version.error||version.data?.status!=='published')
        throw new Error('SHADOW_RESUME_UNAVAILABLE');
      const inbox=await db.from('automation_event_inbox')
        .select('source,event_id,event_type,context_refs')
        .eq('workspace_id',workspaceId).eq('id',execution.data.inbox_id).maybeSingle();
      if(inbox.error||!inbox.data||!inbox.data.context_refs)
        throw new Error('SHADOW_RESUME_UNAVAILABLE');
      failureCode='SHADOW_RESUME_CONTEXT';
      const context=await loadShadowCanonicalContext(
        db,inbox.data.event_type,inbox.data.context_refs
      );
      failureCode='SHADOW_RESUME_PLAN';
      const decision=await planServerShadowCompiled(version.data.graph_json,{
        workspaceId,flowVersionId:execution.data.flow_version_id,
        source:inbox.data.source,eventId:inbox.data.event_id,
        eventType:inbox.data.event_type,context,
      },refs,{nodeId:timer.node_id,port:'out'});
      if(decision.state==='blocked'||!decision.trace.length)
        throw new Error('SHADOW_RESUME_PLAN');
      failureCode='SHADOW_RESUME_ACK';
      const saved=await db.rpc('automation_wait_shadow_resume',{
        p_workspace_id:workspaceId,p_wait_id:timer.id,p_decision:decision,
      });
      if(saved.error)throw new Error('SHADOW_RESUME_ACK');
      resumedTimers++;
    }catch{
      // Only bounded fixed reason codes; no external payloads or PII in logs.
      let failed:null|{error:unknown;data:unknown}=null;
      try {
        failed=await db.rpc('automation_wait_shadow_resume_fail',{
          p_workspace_id:workspaceId,p_wait_id:timer.id,p_code:failureCode,
        });
      }catch { /* retain due timer for retry by next worker */ }
      if(failed?.error||!failed)unresolved++;
      else if(failed.data==='quarantined')resumeQuarantined++;
      else resumeRetries++;
    }
  }
  return json({
    ok:true,shadowOnly:true,dispatchAuthorized:false,
    timersStoppedByPolicy:Number(guarded.data||0),
    timersDue:due.data.filter((x:{result_state:string})=>x.result_state==='due').length,
    timersCancelled:due.data.filter((x:{result_state:string})=>x.result_state==='cancelled').length,
    processed,unresolved,failedRecorded,quarantined,
    resumedTimers,resumeRetries,resumeQuarantined,recovered:recovered.data||0,
    crmScanned:Number(ingested.data?.scanned||0),crmInserted:Number(ingested.data?.inserted||0),
    waScanned:Number(ingestedWa.data?.scanned||0),waInserted:Number(ingestedWa.data?.inserted||0),
  });
});
