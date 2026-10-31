/**
 * ORYNEO end-to-end: genuine PostgreSQL 17 disposable QA + compiled Deno
 * interpreter. No provider clients, external channels or production secrets.
 *
 * Runs ONLY in the isolated GitHub Actions PostgreSQL job, after schema QA.
 */
import { planServerShadowCompiled } from '../functions/automation-api/shadowEngine.ts';
import type { TrustedReferences } from '../functions/automation-api/graphGuard.ts';

const w='cf000000-0000-4000-8000-000000000001';
const flow='cf000000-0000-4000-8000-000000000002';
const version='cf000000-0000-4000-8000-000000000003';
const SQL_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assert(ok:unknown,msg:string):asserts ok { if(!ok)throw Error(msg); }
async function sql(stmt:string){
 const proc=new Deno.Command('psql',{
  args:['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c','SET ROLE service_role; '+stmt],
  stdout:'piped',stderr:'piped'
 });
 const result=await proc.output();
 const output=new TextDecoder().decode(result.stdout).trim();
 if(result.code!==0){
  const stderr=new TextDecoder().decode(result.stderr);
  throw Error('Disposable PostgreSQL integration failed: '+stderr.slice(0,1200));
 }
 return output;
}
function sqlLiteral(v:string){return "'"+v.replaceAll("'","''")+"'";}
const refs:TrustedReferences={
 eventTypes:[
  'opportunity.created','opportunity.updated','opportunity.stage_changed',
  'lead.intake_received','checkout.started','checkout.expired',
  'billing.paid_verified','billing.failed','conversation.inbound',
  'conversation.human_takeover','meeting.scheduled','proposal.sent'],
 stageIds:[],templateIds:[],knowledgeIds:[],dictionaryIds:[],
};
try {
 // Same backend functions as the hosted worker, but on a disposable database.
 // A dedicated workspace prevents older SQL fixtures from influencing the
 // selected event or expected flow count; no production workspace is touched.
 await sql("INSERT INTO public.automation_workspaces(id,slug,active) VALUES ("+
  sqlLiteral(w)+"::uuid,'qa-engine-db-bridge',true);"+
  "INSERT INTO public.automation_runtime_settings(workspace_id,mode,emergency_stop) VALUES ("+
  sqlLiteral(w)+"::uuid,'shadow',false);"+
  "INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled) VALUES ("+
  sqlLiteral(flow)+"::uuid,"+sqlLiteral(w)+"::uuid,'qa-bridge-flow','Compiler SQL bridge','pipeline',false);"+
  "WITH g AS (SELECT jsonb_set(graph_json,'{id}',to_jsonb("+sqlLiteral(flow)+"::text)) x "+
  "FROM public.automation_flow_versions WHERE flow_id='44444444-4444-4444-8444-444444444444' "+
  "AND status='published' ORDER BY version DESC LIMIT 1) "+
  "INSERT INTO public.automation_flow_versions"+
  "(id,workspace_id,flow_id,version,schema_version,status,graph_json,content_sha256,published_by,published_at) "+
  "SELECT "+sqlLiteral(version)+"::uuid,"+sqlLiteral(w)+"::uuid,"+
    sqlLiteral(flow)+"::uuid,1,'1.0.0','published',x,"+
    "encode(sha256(convert_to(x::text,'UTF8')),'hex'),"+
    "'cf000000-0000-4000-8000-000000000009'::uuid,clock_timestamp() FROM g;"+
  "UPDATE public.automation_flows SET published_version_id="+sqlLiteral(version)+"::uuid "+
   "WHERE workspace_id="+sqlLiteral(w)+"::uuid; SELECT 'ready';");
 const inbox=await sql("SELECT public.automation_shadow_ingest('"+w+
  "','crm','qa.bridge.compiler.01','opportunity.created','{}'::jsonb)");
 assert(SQL_ID.test(inbox),'Inbox UUID missing');
 const repeated=await sql("SELECT public.automation_shadow_ingest('"+w+
  "','crm','qa.bridge.compiler.01','opportunity.created','{}'::jsonb)");
 assert(repeated===inbox,'Duplicate ingest created a different inbox row');
 const claimed=await sql("SELECT row_to_json(c)::text FROM ("+
  "SELECT inbox_id,source,event_id,event_type,context_refs,lease_token,attempt "+
  "FROM public.automation_shadow_claim('"+w+"',1)) c");
 const lease=JSON.parse(claimed);
 assert(lease.inbox_id===inbox&&SQL_ID.test(lease.lease_token),'Atomic lease was not acquired');
 assert(lease.attempt===1,'New event was unexpectedly replayed');
 const versions=JSON.parse(await sql("SELECT coalesce(jsonb_agg(jsonb_build_object("+
  "'id',v.id,'graph',v.graph_json) ORDER BY v.version),'[]'::jsonb)::text "+
  "FROM public.automation_flows f JOIN public.automation_flow_versions v "+
  "ON v.id=f.published_version_id AND v.workspace_id=f.workspace_id "+
  "WHERE f.workspace_id='"+w+"' AND f.enabled=false AND v.status='published' "+
  "AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n "+
  "WHERE n->>'type'='trigger' AND n->'config'->>'event_type'='opportunity.created')"));
 assert(Array.isArray(versions)&&versions.length>=1,'No matching immutable published fixture');
 const plans=[];
 for(const v of versions){
  assert(SQL_ID.test(v.id),'Invalid version id');
  const decision=await planServerShadowCompiled(v.graph,{
   workspaceId:w,flowVersionId:v.id,source:lease.source,eventId:lease.event_id,
   eventType:lease.event_type,context:{event:{type:lease.event_type}},
  },refs);
  assert(decision.state==='completed','Deterministic graph did not complete: '+JSON.stringify(decision.issues));
  assert(decision.dispatchAuthorized===false&&decision.plannedActions.length===0,
   'Non-emitting QA planned a side effect');
  plans.push({flowVersionId:v.id,decision});
 }
 const finish=JSON.parse(await sql("SELECT public.automation_shadow_finish("+
  sqlLiteral(w)+"::uuid,"+sqlLiteral(inbox)+"::uuid,"+
  sqlLiteral(lease.lease_token)+"::uuid,"+
  sqlLiteral(JSON.stringify(plans))+"::jsonb)::text"));
 assert(finish.shadowOnly===true&&finish.dispatchAuthorized===false,
  'Completion claimed dispatch rights');
 assert(finish.flowCount===plans.length,'DB omitted a compiled graph plan');
 const summary=JSON.parse(await sql("SELECT jsonb_build_object("+
  "'inboxState',(SELECT state FROM public.automation_event_inbox WHERE id="+sqlLiteral(inbox)+"::uuid),"+
  "'executionCount',(SELECT count(*) FROM public.automation_executions WHERE inbox_id="+sqlLiteral(inbox)+"::uuid),"+
  "'nodeCount',(SELECT count(*) FROM public.automation_node_executions WHERE execution_id IN"+
  "(SELECT id FROM public.automation_executions WHERE inbox_id="+sqlLiteral(inbox)+"::uuid)),"+
  "'outboundCount',(SELECT count(*) FROM public.automation_action_outbox "+
  "WHERE state IN ('queued','leased','sent')))::text"));
 assert(summary.inboxState==='processed','Inbox did not reach processed state');
 assert(summary.executionCount===plans.length,'Execution idempotency failed');
 assert(summary.nodeCount>=plans.length*2,'Persisted node trace incomplete');
 assert(summary.outboundCount===0,'Shadow bridge queued or sent an effect');
 const again=await sql("SELECT count(*) FROM public.automation_executions WHERE inbox_id="+sqlLiteral(inbox)+"::uuid");
 assert(Number(again)===plans.length,'Replay produced a second execution');
 console.log('oryneo-engine-db-bridge-passed: durable SQL+compiler, '+plans.length+
   ' flow(s), '+summary.nodeCount+' node trace(s), 0 outbound effects');
} finally {
 // Cleanup is performed even on failed tests, in a disposable database ONLY.
 await sql("UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id='"+w+
  "'; UPDATE public.automation_workspaces SET active=false WHERE id='"+w+"'; SELECT 'disabled';");
}
