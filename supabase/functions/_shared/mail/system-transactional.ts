import {safeToRetryOutbox,sendMail,type ComposeInput,type MailSendDependencies} from './actions.ts';
import {SupabaseMailDatabase} from './database.ts';
import {ImapClient,SmtpClient} from './transport.ts';
import {renderTransactionalEmail,type TransactionalId,type TransactionalInput} from './transactional-templates.ts';

type Db=any;
async function mailbox(db:Db){const {data,error}=await db.from('crm_mailboxes').select('id,address').eq('active',true).order('created_at').limit(1).maybeSingle();if(error||!data?.id||!data?.address)throw Error('BILLING_MAILBOX_UNAVAILABLE');return data as{id:string;address:string}}
function dependencies(db:Db):MailSendDependencies{
 const mailDb=new SupabaseMailDatabase(db);
 const withImap=async<T>(credentials:any,op:(client:ImapClient)=>Promise<T>)=>{const client=new ImapClient({host:credentials.imapHost,port:credentials.imapPort,username:credentials.address,password:credentials.password});try{await client.connect();await client.login();const value=await op(client);await client.logout();return value}catch(error){client.close();throw error}};
 return{
  getCredentials:id=>mailDb.getCredentials(id),
  async beginOutbox(userId,input,messageId){const inserted=await db.from('crm_mail_outbox').insert({mailbox_id:input.mailboxId,created_by:userId,idempotency_key:input.idempotencyKey,internet_message_id:messageId,payload:{...input,attachments:[]},source:'system',state:'sending',attempts:1}).select('state,internet_message_id,accepted_at').maybeSingle();if(!inserted.error&&inserted.data)return{state:inserted.data.state,internetMessageId:inserted.data.internet_message_id,acceptedAt:inserted.data.accepted_at};if(inserted.error?.code!=='23505')throw Error('MAIL_SEND');const {data,error}=await db.from('crm_mail_outbox').select('state,internet_message_id,accepted_at,created_by,attempts,error_code,source').eq('idempotency_key',input.idempotencyKey).single();if(error||!data||data.created_by!==null||data.source!=='system')throw Error('MAIL_SEND');if(data.state==='sending'&&!data.accepted_at)throw Error('MAIL_IN_PROGRESS');if(data.state==='failed'){if(!safeToRetryOutbox(data.state,data.accepted_at,data.error_code))throw Error('MAIL_IN_PROGRESS');const u=await db.from('crm_mail_outbox').update({state:'sending',attempts:Number(data.attempts)+1,error_code:null}).eq('idempotency_key',input.idempotencyKey).eq('state','failed').select('id').maybeSingle();if(u.error||!u.data)throw Error('MAIL_IN_PROGRESS')}return{state:data.state,internetMessageId:data.internet_message_id,acceptedAt:data.accepted_at}},
  findSentMessage:(c,id)=>withImap(c,async imap=>{const folders=await imap.list();const folder=folders.find(f=>f.attributes.some(a=>a.toLowerCase()==='\\sent'))??folders.find(f=>/(^|[./])(sent|enviad)/i.test(f.name));if(!folder)throw Error('MAIL_APPEND');await imap.select(folder.name);return(await imap.searchHeader('Message-ID',id)).length>0}),
  async smtpSend(c,envelope){await new SmtpClient({host:c.smtpHost,port:c.smtpPort,username:c.address,password:c.password}).send(envelope)},
  appendSent:(c,raw)=>withImap(c,async imap=>{const folders=await imap.list();const folder=folders.find(f=>f.attributes.some(a=>a.toLowerCase()==='\\sent'))??folders.find(f=>/(^|[./])(sent|enviad)/i.test(f.name));if(!folder)throw Error('MAIL_APPEND');await imap.append(folder.name,raw,['\\Seen'])}),
  async markAccepted(id){const {error}=await db.from('crm_mail_outbox').update({accepted_at:new Date().toISOString(),state:'sending'}).eq('idempotency_key',id);if(error)throw Error('MAIL_SEND')},
  async markSent(id){const {error}=await db.from('crm_mail_outbox').update({state:'sent',error_code:null}).eq('idempotency_key',id);if(error)throw Error('MAIL_SEND')},
  async markFailed(id,code){await db.from('crm_mail_outbox').update({state:'failed',error_code:code}).eq('idempotency_key',id)},
 }
}
export async function sendSystemTransactionalEmail(db:Db,args:{idempotencyKey:string;template:TransactionalId;data:TransactionalInput;recipient?:string|null;recipientName?:string}){
 const active=await mailbox(db);const rendered=renderTransactionalEmail(args.template,args.data);const input:ComposeInput={mailboxId:active.id,idempotencyKey:args.idempotencyKey,to:[{address:args.recipient||active.address,name:args.recipientName||args.data.firstName}],subject:rendered.subject,text:rendered.text,html:rendered.html};return sendMail(dependencies(db),null,input)
}
export async function deterministicMailUuid(seed:string){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(seed))).slice(0,16);bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`}
export async function systemMailboxAddress(db:Db){return(await mailbox(db)).address}
