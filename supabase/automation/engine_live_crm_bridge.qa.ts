/**
 * Macro 6: REAL compiled Deno decisions -> PostgreSQL 17 ephemeral live CRM RPCs.
 * No production credentials, providers, network fetch, sends or billing changes.
 * Uses only synthetic CRM state and always restores emergency stop.
 */
import {planServerShadowCompiled} from '../functions/automation-api/shadowEngine.ts';
import type {TrustedReferences} from '../functions/automation-api/graphGuard.ts';
const w='11111111-1111-4111-8111-111111111111';
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const deal='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const flow='da000000-0000-4000-8000-000000000001';
const version='da000000-0000-4000-8000-000000000002';
const event='da000000-0000-4000-8000-000000000003';
const start='da000000-0000-4000-8000-000000000004';
const task='da000000-0000-4000-8000-000000000005';
const end='da000000-0000-4000-8000-000000000006';
const graph={id:flow,name:'Live CRM isolated bridge',kind:'pipeline',
 status:'published',version:1,schema_version:'1.0.0',
 nodes:[
  {id:start,type:'trigger',label:'Evento',position:{x:0,y:0},
   config:{event_type:'opportunity.created'},ports:['out']},
  {id:task,type:'crm_task',label:'Ação',position:{x:300,y:0},
   config:{title:'Agendar diagnóstico',due_offset_minutes:15},ports:['in','out']},
  {id:end,type:'end',label:'Fim',position:{x:600,y:0},config:{},ports:['in']},
 ],
 edges:[
  {id:'da000000-0000-4000-8000-000000000007',
   source:start,source_port:'out',target:task,target_port:'in'},
  {id:'da000000-0000-4000-8000-000000000008',
   source:task,source_port:'out',target:end,target_port:'in'},
 ]};
const refs:TrustedReferences={
 eventTypes:['opportunity.created'],stageIds:[],templateIds:[],
 knowledgeIds:[],dictionaryIds:[],
};
const must=(v:unknown,m:string):asserts v=>{if(!v)throw Error(m)};
const lit=(s:string)=>"'"+s.replaceAll("'","''")+"'";
async function sql(query:string):Promise<string>{
 const proc=new Deno.Command('psql',{
  args:['-X','-q','-A','-t','-v','ON_ERROR_STOP=1',
   '-c','SET ROLE service_role; '+query],
  stdout:'piped',stderr:'piped',
 });
 const out=await proc.output();
 const err=new TextDecoder().decode(out.stderr);
 if(out.code!==0)throw Error('EPHEMERAL_DB_FAILED: '+err.slice(0,1200));
 return new TextDecoder().decode(out.stdout).trim();
}
try{
 await sql("UPDATE public.automation_workspaces SET active=false WHERE id="+lit(w)+"::uuid;"+
  "UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id="+lit(w)+"::uuid;"+
  "SELECT public.automation_live_crm_init_cursor("+lit(w)+"::uuid,"+lit(actor)+"::uuid);");
 await sql("INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled) VALUES ("+
  lit(flow)+"::uuid,"+lit(w)+"::uuid,'qa-macro6-real-compiler','CRM Deno SQL bridge','pipeline',false);"+
  "WITH item AS (SELECT "+lit(JSON.stringify(graph))+"::jsonb g) "+
  "INSERT INTO public.automation_flow_versions(id,workspace_id,flow_id,version,schema_version,graph_json,content_sha256,status,published_by,published_at) "+
  "SELECT "+lit(version)+"::uuid,"+lit(w)+"::uuid,"+lit(flow)+"::uuid,1,'1.0.0',g,"+
  "encode(sha256(convert_to(g::text,'UTF8')),'hex'),'published',"+lit(actor)+"::uuid,clock_timestamp() FROM item;"+
  "UPDATE public.automation_flows SET published_version_id="+lit(version)+"::uuid,enabled=true WHERE id="+lit(flow)+"::uuid;"+
  "UPDATE public.automation_workspaces SET active=true WHERE id="+lit(w)+"::uuid;"+
  "UPDATE public.automation_runtime_settings SET mode='live',emergency_stop=false WHERE workspace_id="+lit(w)+"::uuid;"+
  "UPDATE public.automation_channel_ownership SET owner='new_engine',"+
   "legacy_dispatch_paused_at=clock_timestamp()-interval '1 minute',"+
   "release_approved_at=clock_timestamp(),release_id='qa-only-compiler' "+
   "WHERE workspace_id="+lit(w)+"::uuid AND channel='crm';"+
  "INSERT INTO public.crm_events(id,deal_id,event_type,created_at) VALUES ("+
   lit(event)+"::uuid,"+lit(deal)+"::uuid,'received',clock_timestamp());");
 const first=JSON.parse(await sql("SELECT public.automation_live_crm_poll("+lit(w)+"::uuid,20)::text"));
 must(first.scanned>=1,'Canonical event not ingested');
 const row=await sql("SELECT row_to_json(q)::text FROM (SELECT inbox_id,source,event_id,event_type,context_refs,lease_token "+
  "FROM public.automation_live_crm_claim("+lit(w)+"::uuid,10) "+
  "WHERE event_id="+lit('crm:'+event)+") q");
 must(row.length>0,'Live CRM inbox could not be claimed');
 const claim=JSON.parse(row);
 must(claim.event_type==='opportunity.created','Canonical event mapping changed');
 const decision=await planServerShadowCompiled(graph,{
  workspaceId:w,flowVersionId:version,source:claim.source,
  eventId:claim.event_id,eventType:claim.event_type,
  context:{event:{type:claim.event_type}},
 },refs);
 must(decision.state==='awaiting_server_outcome'&&
  decision.plannedActions.length===1&&
  decision.plannedActions[0].type==='crm_task','Real compiler did not plan CRM task');
 const plan=[{flowVersionId:version,decision}];
 const ack=JSON.parse(await sql("SELECT public.automation_live_crm_finish("+
  lit(w)+"::uuid,"+lit(claim.inbox_id)+"::uuid,"+
  lit(claim.lease_token)+"::uuid,"+lit(JSON.stringify(plan))+"::jsonb)::text"));
 must(ack.ok===true&&ack.dispatchAuthorized===false,'Compiled SQL commit failed');
 const entry=JSON.parse(await sql("SELECT row_to_json(q)::text FROM ("+
  "SELECT a.id,a.action_key,a.node_id,e.id execution_id "+
  "FROM public.automation_action_outbox a JOIN public.automation_executions e ON e.id=a.execution_id "+
  "WHERE e.inbox_id="+lit(claim.inbox_id)+"::uuid AND a.action_type='crm_task') q"));
 must(entry.node_id===task&&entry.action_key===decision.plannedActions[0].actionKey,
  'Compiled action key lost durable integrity');
 // Simulated durable CRM adapter acknowledgement in disposable DB ONLY.
 await sql("UPDATE public.automation_action_outbox SET state='sent',provider_result_id="+
   lit('crm:'+entry.action_key)+" WHERE id="+lit(entry.id)+"::uuid");
 const resumed=await planServerShadowCompiled(graph,{
  workspaceId:w,flowVersionId:version,source:claim.source,
  eventId:claim.event_id,eventType:claim.event_type,
  context:{event:{type:claim.event_type}},
 },refs,{nodeId:task,port:'out'});
 must(resumed.state==='completed'&&resumed.plannedActions.length===0,
  'Terminal continuation did not complete');
 const result=JSON.parse(await sql("SELECT public.automation_live_crm_continue("+
  lit(w)+"::uuid,"+lit(entry.execution_id)+"::uuid,"+
  lit(entry.id)+"::uuid,"+lit(JSON.stringify(resumed))+"::jsonb)::text"));
 must(result.ok===true&&result.complete===true,'CRM SQL continuation not acknowledged');
 const state=await sql("SELECT state FROM public.automation_executions WHERE id="+
  lit(entry.execution_id)+"::uuid");
 must(state==='completed','Execution not in terminal state');
 console.log('macro6-deno-to-live-crm-postgres-qa-passed: plan, outbox, continuation, no providers');
}finally{
 await sql("UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true "+
  "WHERE workspace_id="+lit(w)+"::uuid;"+
  "UPDATE public.automation_workspaces SET active=false WHERE id="+lit(w)+"::uuid;SELECT 'stopped';");
}
