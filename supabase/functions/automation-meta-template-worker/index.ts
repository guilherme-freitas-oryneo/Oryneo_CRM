/**
 * ORYNEO reviewed Meta template executor — OFF unless explicitly opted in.
 *
 * DO NOT DEPLOY or schedule before verified release + single-owner WhatsApp
 * cutover. The existing human inbox and SDR continue as legacy owners.
 * Every action has a durable lease; timeouts are UNCERTAIN and never replayed.
 * No free-text replies, attachments or billing operations.
 */
import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
import {workerIsConfigured,validWorkerToken}
 from '../automation-shadow-worker/workerGuards.ts';
import {loadMetaCanonicalContext}
 from '../automation-api/metaCanonicalContext.ts';
import {resolveTemplateBindings}
 from '../automation-api/templateBindings.ts';
import {freshApprovedTemplate,sendVerifiedTemplate}
 from '../automation-api/metaTemplateTransport.ts';
import {renderVerifiedMetaTemplate}
 from '../automation-api/metaTemplateApproval.ts';

const url=Deno.env.get('SUPABASE_URL')||'';
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const workspaceId=Deno.env.get('AUTOMATION_META_WORKSPACE_ID')||'';
const workerSecret=Deno.env.get('AUTOMATION_META_WORKER_SECRET')||'';
const enabled=Deno.env.get('AUTOMATION_META_SENDER_ENABLED')==='true';
const metaToken=Deno.env.get('WHATSAPP_SYSTEM_USER_TOKEN')||'';
const configuredPhone=Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')||'';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'},
});
type Claim={action_id:string;claim_token:string;action_key:string;
 conversation_id:string;template_registry_id:string;phone_number_id:string;
 whatsapp_account_id:string;messaging_account_id:string};
type Node={id:string;type:string;config?:{
 template_registry_id?:string;locale?:string;bindings?:unknown}};
type Registry={id:string;provider_account_id:string;provider_template_id:string;
 template_name:string;language:string;category:string;provider_status:string;
 parameter_schema:{variable_numbers?:unknown;components_verified?:boolean;
 meta_components?:Array<{text?:string;type?:string}>}};
const parseKeys=(schema:Registry['parameter_schema']):string[]=>{
 const arr=schema?.variable_numbers;
 if(!Array.isArray(arr)||!arr.length||arr.length>20
   ||arr.some(x=>typeof x!=='string'||!/^[1-9][0-9]?$/.test(x))
   ||new Set(arr).size!==arr.length)throw Error('META_COMPONENTS_UNVERIFIED');
 return arr as string[];
};
Deno.serve(async request=>{
 if(request.method!=='POST')return response({error:'Method not allowed'},405);
 if(!workerIsConfigured({enabled,projectUrl:url,serviceRole:key,
   workspaceId,workerSecret})||!metaToken||!configuredPhone)
  return response({error:'Meta sender disabled'},503);
 if(!validWorkerToken(request.headers.get('x-oryneo-meta-worker-secret')||'',
    workerSecret))return response({error:'Access denied'},401);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const gate=await db.rpc('automation_channel_cutover_preflight',{
  p_workspace_id:workspaceId,p_channel:'whatsapp',
 });
 if(gate.error||gate.data?.eligible!==true||gate.data?.dispatchAuthorized!==false)
  return response({ok:true,disabled:true,claimed:0});
 const claims=await db.rpc('automation_whatsapp_claim_template',{
  p_workspace_id:workspaceId,p_limit:2,
 });
 if(claims.error||!Array.isArray(claims.data))
  return response({error:'Meta action lease unavailable'},503);
 let sent=0,uncertain=0,failed=0,unresolved=0;
 for(const item of claims.data as Claim[]){
  let didPost=false;
  let delivery:'sent'|'uncertain'|'failed'='failed';
  let receipt='';
  let rendered='';
  try{
   if(item.phone_number_id!==configuredPhone)
    throw Error('META_CHANNEL_MISMATCH');
   const [registry,action]=await Promise.all([
    db.from('automation_template_registry')
     .select('id,provider_account_id,provider_template_id,template_name,language,category,provider_status,parameter_schema')
     .eq('workspace_id',workspaceId)
     .eq('id',item.template_registry_id).maybeSingle(),
    db.from('automation_action_outbox')
     .select('id,execution_id,node_id,action_type,state,claim_token')
     .eq('workspace_id',workspaceId).eq('id',item.action_id).maybeSingle(),
   ]);
   if(registry.error||action.error||!registry.data||!action.data
      ||action.data.state!=='leased'
      ||action.data.claim_token!==item.claim_token
      ||action.data.action_type!=='whatsapp_template')
    throw Error('META_CLAIM_STALE');
   const meta=registry.data as Registry;
   if(meta.provider_account_id!==item.messaging_account_id
      ||meta.provider_status!=='APPROVED'
      ||meta.language!=='pt_BR'
      ||!['UTILITY','MARKETING'].includes(meta.category)
      ||meta.parameter_schema?.components_verified!==true)
    throw Error('META_TEMPLATE_REGISTRY_MISMATCH');
   const keys=parseKeys(meta.parameter_schema);
   const {data:execution,error:executionError}=await db.from('automation_executions')
    .select('flow_version_id').eq('workspace_id',workspaceId)
    .eq('id',action.data.execution_id).maybeSingle();
   if(executionError||!execution?.flow_version_id)
    throw Error('META_FLOW_UNAVAILABLE');
   const {data:version,error:versionError}=await db.from('automation_flow_versions')
    .select('graph_json,status').eq('workspace_id',workspaceId)
    .eq('id',execution.flow_version_id).maybeSingle();
   if(versionError||!version||version.status!=='published'
      ||!Array.isArray(version.graph_json?.nodes))
    throw Error('META_FLOW_UNAVAILABLE');
   const node=(version.graph_json.nodes as Node[]).find(n=>
     n.id===action.data.node_id&&n.type==='whatsapp_template'
      &&n.config?.template_registry_id===meta.id&&n.config?.locale==='pt_BR');
   if(!node)throw Error('META_NODE_NOT_CANONICAL');
   const canonical=await loadMetaCanonicalContext(db,item.conversation_id);
   if(canonical.channelId===undefined)throw Error('META_CHANNEL_MISSING');
   const binding=resolveTemplateBindings(node.config?.bindings,keys,canonical.context);
   if(!binding.ok)throw Error('META_VARIABLE_SOURCE_UNAVAILABLE');
   const snapshot=meta.parameter_schema?.meta_components?.[0]?.text;
   if(typeof snapshot!=='string'||!snapshot)
    throw Error('META_TEMPLATE_SNAPSHOT_UNAVAILABLE');
   const approved=await freshApprovedTemplate(fetch,metaToken,{
    id:meta.provider_template_id,name:meta.template_name,language:'pt_BR',
    category:meta.category as 'UTILITY'|'MARKETING',variable_numbers:keys,
   },snapshot);
   if(!approved)throw Error('META_CURRENT_APPROVAL_UNAVAILABLE');
   rendered=renderVerifiedMetaTemplate(snapshot,keys,binding.values);
   // Revalidate the exclusive owner as near as possible to the POST. A
   // fresh native Meta approval cannot replace the business consent check.
   const policy=await db.rpc('automation_channel_cutover_preflight',{
    p_workspace_id:workspaceId,p_channel:'whatsapp',
   });
   if(policy.error||policy.data?.eligible!==true)
    throw Error('META_CHANNEL_RELEASE_REVOKED');
   const again=await loadMetaCanonicalContext(db,item.conversation_id);
   if(again.recipient!==canonical.recipient||
     again.channelId!==canonical.channelId)throw Error('META_CONTEXT_DRIFT');
   // Final provider-side effect. NO automatic retry at this boundary.
   didPost=true;
   const out=await sendVerifiedTemplate(fetch,metaToken,item.phone_number_id,{
    recipient:again.recipient,name:meta.template_name,locale:'pt_BR',
    values:binding.values,expectedCount:keys.length,
   });
   if(out.kind==='accepted'){delivery='sent';receipt=out.receipt;}
   else if(out.kind==='uncertain')delivery='uncertain';
   else delivery='failed';
  }catch{
   // After POST starts an exception can be ambiguous. Never mark a known
   // attempt as definitely unsent merely because local processing failed.
   delivery=didPost?'uncertain':'failed';
  }
  if(delivery==='sent'){
   try{
    const r=await db.rpc('automation_meta_template_receipt',{
     p_workspace_id:workspaceId,p_action_id:item.action_id,
     p_claim_token:item.claim_token,p_provider_message_id:receipt,
     p_rendered_body:rendered,
    });
    if(r.error||r.data?.ok!==true){unresolved++;continue;}
    sent++;continue;
   }catch{unresolved++;continue;}
  }
  try{
   const done=await db.rpc('automation_delivery_finish',{
    p_workspace_id:workspaceId,p_action_id:item.action_id,
    p_claim_token:item.claim_token,
    p_state:delivery,p_provider_result_id:null,
   });
   if(done.error){unresolved++;continue;}
   if(delivery==='uncertain')uncertain++;else failed++;
  }catch{unresolved++;}
 }
 return response({ok:true,channel:'whatsapp_template',claimed:claims.data.length,
  sent,uncertain,failed,unresolved,automaticRetries:0,paymentsCreated:0});
});
