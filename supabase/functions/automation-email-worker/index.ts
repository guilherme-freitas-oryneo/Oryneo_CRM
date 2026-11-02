/** Reviewed automation e-mail executor. Dormant unless every release gate and
 * the explicit worker flag are enabled. Provider ambiguity is never retried. */
import {createClient} from '../_shared/mail/deps.ts';
import {safeToRetryOutbox,sendMail,type ComposeInput,type MailSendDependencies} from '../_shared/mail/actions.ts';
import {SupabaseMailDatabase} from '../_shared/mail/database.ts';
import type {MailCredentials} from '../_shared/mail/sync.ts';
import {ImapClient,SmtpClient} from '../_shared/mail/transport.ts';
import {workerIsConfigured,validWorkerToken} from '../automation-shadow-worker/workerGuards.ts';
import {renderApprovedEmailText} from '../automation-api/emailTemplateRender.ts';

const url=Deno.env.get('SUPABASE_URL')||'';
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const workspaceId=Deno.env.get('AUTOMATION_EMAIL_WORKSPACE_ID')||'';
const workerSecret=Deno.env.get('AUTOMATION_EMAIL_WORKER_SECRET')||'';
const enabled=Deno.env.get('AUTOMATION_EMAIL_SENDER_ENABLED')==='true';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'},
});
type Claim={action_id:string;claim_token:string;action_key:string;opportunity_id:string;
 recipient:string;mailbox_id:string;template_id:string;purpose:string;
 subject_template:string;body_text_template:string;contact_name:string;company:string};

const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const database=new SupabaseMailDatabase(client);
async function withImap<T>(credentials:MailCredentials,operation:(imap:ImapClient)=>Promise<T>):Promise<T>{
 const imap=new ImapClient({host:credentials.imapHost,port:credentials.imapPort,
  username:credentials.address,password:credentials.password});
 try{await imap.connect();await imap.login();const result=await operation(imap);await imap.logout();return result;}
 catch(error){imap.close();throw error;}
}
async function sentFolder(imap:ImapClient):Promise<string>{
 const folders=await imap.list();
 const folder=folders.find(entry=>entry.attributes.some(attribute=>attribute.toLowerCase()==='\\sent'))
  ??folders.find(entry=>/(^|[./])(sent|enviad)/i.test(entry.name));
 if(!folder)throw Error('MAIL_APPEND');return folder.name;
}
const dependencies:MailSendDependencies={
 getCredentials:mailboxId=>database.getCredentials(mailboxId),
 async beginOutbox(_userId,input,internetMessageId){
  const inserted=await client.from('crm_mail_outbox').insert({mailbox_id:input.mailboxId,
   created_by:null,idempotency_key:input.idempotencyKey,internet_message_id:internetMessageId,
   payload:{...input,attachments:[]},source:'system',state:'sending',attempts:1,
  }).select('state,internet_message_id,accepted_at,created_by,attempts').maybeSingle();
  if(!inserted.error&&inserted.data)return {state:inserted.data.state,
   internetMessageId:inserted.data.internet_message_id,acceptedAt:inserted.data.accepted_at};
  if(inserted.error?.code!=='23505')throw Error('MAIL_SEND');
  const existing=await client.from('crm_mail_outbox')
   .select('state,internet_message_id,accepted_at,created_by,attempts,error_code,source')
   .eq('idempotency_key',input.idempotencyKey).single();
  const data=existing.data;
  if(existing.error||!data||data.created_by!==null||data.source!=='system')throw Error('MAIL_SEND');
  if(data.state==='sending'&&!data.accepted_at)throw Error('MAIL_IN_PROGRESS');
  if(data.state==='failed'){
   if(!safeToRetryOutbox(data.state,data.accepted_at,data.error_code))throw Error('MAIL_IN_PROGRESS');
   const updated=await client.from('crm_mail_outbox').update({state:'sending',
    attempts:Number(data.attempts)+1,error_code:null}).eq('idempotency_key',input.idempotencyKey)
    .eq('state','failed').select('id').maybeSingle();
   if(updated.error||!updated.data)throw Error('MAIL_IN_PROGRESS');
  }
  return {state:data.state,internetMessageId:data.internet_message_id,acceptedAt:data.accepted_at};
 },
 findSentMessage:(credentials,messageId)=>withImap(credentials,async imap=>{
  await imap.select(await sentFolder(imap));return (await imap.searchHeader('Message-ID',messageId)).length>0;
 }),
 async smtpSend(credentials,envelope){
  const smtp=new SmtpClient({host:credentials.smtpHost,port:credentials.smtpPort,
   username:credentials.address,password:credentials.password});await smtp.send(envelope);
 },
 appendSent:(credentials,raw)=>withImap(credentials,async imap=>{
  await imap.append(await sentFolder(imap),raw,['\\Seen']);
 }),
 async markAccepted(idempotencyKey){
  const result=await client.from('crm_mail_outbox').update({accepted_at:new Date().toISOString(),
   state:'sending'}).eq('idempotency_key',idempotencyKey);if(result.error)throw Error('MAIL_SEND');
 },
 async markSent(idempotencyKey){
  const result=await client.from('crm_mail_outbox').update({state:'sent',error_code:null})
   .eq('idempotency_key',idempotencyKey);if(result.error)throw Error('MAIL_SEND');
 },
 async markFailed(idempotencyKey,errorCode){
  await client.from('crm_mail_outbox').update({state:'failed',error_code:errorCode})
   .eq('idempotency_key',idempotencyKey);
 },
};

Deno.serve(async request=>{
 if(request.method!=='POST')return response({error:'Method not allowed'},405);
 if(!workerIsConfigured({enabled,projectUrl:url,serviceRole:key,workspaceId,workerSecret}))
  return response({error:'E-mail sender disabled'},503);
 if(!validWorkerToken(request.headers.get('x-oryneo-email-worker-secret')||'',workerSecret))
  return response({error:'Access denied'},401);
 const gate=await client.rpc('automation_channel_cutover_preflight',{
  p_workspace_id:workspaceId,p_channel:'email',
 });
 if(gate.error||gate.data?.eligible!==true||gate.data?.dispatchAuthorized!==false)
  return response({ok:true,disabled:true,claimed:0});
 const claims=await client.rpc('automation_email_claim',{p_workspace_id:workspaceId,p_limit:3});
 if(claims.error||!Array.isArray(claims.data))return response({error:'E-mail lease unavailable'},503);
 let sent=0,failed=0,uncertain=0,unresolved=0;
 for(const claim of claims.data as Claim[]){
  let providerAttempted=false;let state:'sent'|'failed'|'uncertain'='failed';
  try{
   const subject=renderApprovedEmailText(claim.subject_template,{contactName:claim.contact_name,company:claim.company});
   const text=renderApprovedEmailText(claim.body_text_template,{contactName:claim.contact_name,company:claim.company});
   const presend=await client.rpc('automation_email_pre_send',{p_workspace_id:workspaceId,
    p_action_id:claim.action_id,p_claim_token:claim.claim_token,
    p_opportunity_id:claim.opportunity_id,p_recipient:claim.recipient,
    p_mailbox_id:claim.mailbox_id,p_template_id:claim.template_id});
   const release=await client.rpc('automation_release_missing_gates',{
    p_workspace_id:workspaceId,p_channel:'email',
   });
   if(presend.error||presend.data!==true||release.error
     ||!Array.isArray(release.data)||release.data.length!==0)throw Error('EMAIL_PRESEND_REVOKED');
   const input:ComposeInput={mailboxId:claim.mailbox_id,idempotencyKey:claim.action_id,
    to:[{address:claim.recipient,name:claim.contact_name||undefined}],subject,text};
   providerAttempted=true;
   await sendMail(dependencies,null,input);state='sent';
  }catch{state=providerAttempted?'uncertain':'failed';}
  try{
   const done=await client.rpc('automation_delivery_finish',{p_workspace_id:workspaceId,
    p_action_id:claim.action_id,p_claim_token:claim.claim_token,p_state:state,
    p_provider_result_id:state==='sent'?'mail:'+claim.action_key:null});
   if(done.error){unresolved++;continue;}
   if(state==='sent')sent++;else if(state==='uncertain')uncertain++;else failed++;
  }catch{unresolved++;}
 }
 return response({ok:true,channel:'email',claimed:claims.data.length,sent,failed,uncertain,
  unresolved,automaticRetries:0,paymentsCreated:0});
});
