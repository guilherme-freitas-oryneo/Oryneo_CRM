/** Approved WhatsApp free-text reply executor. Off by default; it only works
 * inside the verified 24-hour window and never retries an ambiguous POST. */
import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
import {workerIsConfigured,validWorkerToken} from '../automation-shadow-worker/workerGuards.ts';
import {loadMetaCanonicalContext} from '../automation-api/metaCanonicalContext.ts';
import {sendVerifiedText} from '../automation-api/metaTemplateTransport.ts';

const url=Deno.env.get('SUPABASE_URL')||'';
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const workspaceId=Deno.env.get('AUTOMATION_META_WORKSPACE_ID')||'';
const workerSecret=Deno.env.get('AUTOMATION_META_REPLY_WORKER_SECRET')||'';
const enabled=Deno.env.get('AUTOMATION_META_REPLY_ENABLED')==='true';
const metaToken=Deno.env.get('WHATSAPP_SYSTEM_USER_TOKEN')||'';
const configuredPhone=Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')||'';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'},
});
type Claim={action_id:string;claim_token:string;action_key:string;
 conversation_id:string;phone_number_id:string;text_ref:string;body_text:string};

Deno.serve(async request=>{
 if(request.method!=='POST')return response({error:'Method not allowed'},405);
 if(!workerIsConfigured({enabled,projectUrl:url,serviceRole:key,workspaceId,workerSecret})
   ||!metaToken||!configuredPhone)return response({error:'Meta reply sender disabled'},503);
 if(!validWorkerToken(request.headers.get('x-oryneo-meta-reply-secret')||'',workerSecret))
  return response({error:'Access denied'},401);
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const gate=await db.rpc('automation_channel_cutover_preflight',{
  p_workspace_id:workspaceId,p_channel:'whatsapp',
 });
 if(gate.error||gate.data?.eligible!==true||gate.data?.dispatchAuthorized!==false)
  return response({ok:true,disabled:true,claimed:0});
 const claims=await db.rpc('automation_whatsapp_claim_reply',{
  p_workspace_id:workspaceId,p_limit:3,
 });
 if(claims.error||!Array.isArray(claims.data))return response({error:'Reply lease unavailable'},503);
 let sent=0,failed=0,uncertain=0,unresolved=0;
 for(const claim of claims.data as Claim[]){
  let posted=false;let state:'sent'|'failed'|'uncertain'='failed';let receipt='';
  try{
   if(claim.phone_number_id!==configuredPhone)throw Error('META_CHANNEL_MISMATCH');
   const context=await loadMetaCanonicalContext(db,claim.conversation_id);
   const presend=await db.rpc('automation_whatsapp_reply_pre_send',{
    p_workspace_id:workspaceId,p_action_id:claim.action_id,p_claim_token:claim.claim_token,
    p_conversation_id:claim.conversation_id,p_phone_number_id:claim.phone_number_id,
    p_text_ref:claim.text_ref,
   });
   const release=await db.rpc('automation_release_missing_gates',{
    p_workspace_id:workspaceId,p_channel:'whatsapp',
   });
   if(presend.error||presend.data!==true||release.error
    ||!Array.isArray(release.data)||release.data.length!==0)
    throw Error('META_REPLY_PRESEND_REVOKED');
   posted=true;
   const result=await sendVerifiedText(fetch,metaToken,claim.phone_number_id,{
    recipient:context.recipient,text:claim.body_text,
   });
   if(result.kind==='accepted'){state='sent';receipt=result.receipt;}
   else if(result.kind==='uncertain')state='uncertain';else state='failed';
  }catch{state=posted?'uncertain':'failed';}
  if(state==='sent'){
   try{
    const recorded=await db.rpc('automation_meta_reply_receipt',{
     p_workspace_id:workspaceId,p_action_id:claim.action_id,p_claim_token:claim.claim_token,
     p_provider_message_id:receipt,p_rendered_body:claim.body_text,
    });
    if(recorded.error||recorded.data?.ok!==true){unresolved++;continue;}
    sent++;continue;
   }catch{unresolved++;continue;}
  }
  try{
   const done=await db.rpc('automation_delivery_finish',{p_workspace_id:workspaceId,
    p_action_id:claim.action_id,p_claim_token:claim.claim_token,p_state:state,
    p_provider_result_id:null});
   if(done.error){unresolved++;continue;}
   if(state==='uncertain')uncertain++;else failed++;
  }catch{unresolved++;}
 }
 return response({ok:true,channel:'whatsapp_reply',claimed:claims.data.length,
  sent,failed,uncertain,unresolved,automaticRetries:0,paymentsCreated:0});
});
