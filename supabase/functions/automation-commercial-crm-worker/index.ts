/** ORYNEO Macro 3 — CRM ONLY controlled executor; NEVER DEPLOY or schedule
 * before explicit release, Schema/Meta approval and legacy dispatch cutover.
 * Unlike the shadow worker, this code may write canonical CRM next_actions
 * and stages ONLY under a published, fenced, single-owner transaction.
 * It cannot send WhatsApp/email, charge Stripe or create outbound messages.
 */
import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
import {workerIsConfigured,validWorkerToken} from '../automation-shadow-worker/workerGuards.ts';

const projectUrl=Deno.env.get('SUPABASE_URL')||'';
const serviceRole=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const workspaceId=Deno.env.get('AUTOMATION_COMMERCIAL_CRM_WORKSPACE_ID')||'';
const secret=Deno.env.get('AUTOMATION_COMMERCIAL_CRM_SECRET')||'';
const enabled=Deno.env.get('AUTOMATION_COMMERCIAL_CRM_ENABLED')==='true';

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
});
type Claim={
 action_id:string;claim_token:string;
 action_type:'crm_stage_change'|'crm_task';
 expected_deal_revision:number;
};

Deno.serve(async request=>{
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(!workerIsConfigured({enabled,projectUrl,serviceRole,workspaceId,workerSecret:secret}))
   return json({error:'CRM action worker disabled'},503);
 if(!validWorkerToken(request.headers.get('x-oryneo-crm-action-secret')||'',secret))
   return json({error:'Access denied'},401);
 const db=createClient(projectUrl,serviceRole,{
   auth:{persistSession:false,autoRefreshToken:false},
 });
 const gate=await db.rpc('automation_channel_cutover_preflight',{
  p_workspace_id:workspaceId,p_channel:'crm',
 });
 if(gate.error||gate.data?.eligible!==true||
  gate.data?.dispatchAuthorized!==false)
  return json({ok:true,processed:0,disabled:true});
 const claims=await db.rpc('automation_commercial_claim_crm',{
   p_workspace_id:workspaceId,p_limit:3,
 });
 if(claims.error||!Array.isArray(claims.data))
   return json({error:'CRM action claim unavailable'},503);
 let processed=0,unresolved=0;
 for(const claim of claims.data as Claim[]){
   // Every RPC rechecks the kill switch, owner, flow version, lease, and
   // canonical optimistic revision in ONE database transaction.
   const proc=claim.action_type==='crm_stage_change'
     ?'automation_crm_stage_action'
     :claim.action_type==='crm_task'
     ?'automation_crm_task_action':null;
   if(!proc){unresolved++;continue;}
   const result=await db.rpc(proc,{
     p_workspace_id:workspaceId,p_action_id:claim.action_id,
     p_claim_token:claim.claim_token,
     p_expected_revision:claim.expected_deal_revision,
   });
   if(result.error){
     // Network ambiguity: never mark sent or automatically retry. Lease
     // recovery quarantines it for reconciliation, preventing duplicate
     // human tasks, stage history or external effects.
     unresolved++;continue;
   }
   if(result.data?.dispatchAuthorized!==false){
     unresolved++;continue;
   }
   processed++;
 }
 return json({ok:true,processed,unresolved,channel:'crm',
  externalMessagesSent:0,paymentsCreated:0});
});
