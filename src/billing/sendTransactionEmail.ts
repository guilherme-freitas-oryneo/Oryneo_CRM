import {supabase} from '../data';
import {invokeMailAction} from '../mail/api';
import {renderTransactionalEmail} from '../emailPreview/transactionalTemplates';

export type CommercialNoticeId='proposal_sent'|'payment_link';
export type CommercialNoticeDetails={
 template:CommercialNoticeId;recipientEmail:string;recipientName:string;company:string;
 actionUrl:string;orderReference?:string;amountCents?:number;idempotencyKey:string
};

export function validOryneoActionUrl(raw:string,template:CommercialNoticeId):boolean{
 try{
  const url=new URL(raw);
  const path=template==='proposal_sent'?'/Oryneo_CRM/proposta/':'/Oryneo_CRM/pagar/';
  const token=url.searchParams.get('token')||'';
  return url.protocol==='https:'&&url.hostname==='guilherme-freitas-oryneo.github.io'
   &&url.pathname===path&&!url.port&&!url.username&&!url.password&&!url.hash
   &&[...url.searchParams.keys()].length===1&&/^[A-Za-z0-9_-]{42,50}$/.test(token);
 }catch{return false}
}

export async function sendCommercialNotice(input:CommercialNoticeDetails){
 const {template,recipientEmail,recipientName,company,actionUrl,orderReference,amountCents,idempotencyKey}=input;
 if(!validOryneoActionUrl(actionUrl,template))throw new Error('Link individual inválido. Reemita o documento.');
 if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipientEmail)||recipientName.trim().length<2)
  throw new Error('Complete o destinatário da comunicação.');
 if(!/^[0-9a-f-]{36}$/i.test(idempotencyKey))throw new Error('Identificador de envio inválido.');
 if(template==='payment_link'&&(!orderReference||!Number.isSafeInteger(amountCents)||amountCents!<0))
  throw new Error('O valor financeiro ainda não foi verificado.');
 const {data:mailbox,error:mailError}=await supabase.from('crm_mailboxes')
  .select('id').eq('active',true).eq('address','contato@oryneo.com.br').maybeSingle();
 if(mailError||!mailbox)throw new Error('Remetente corporativo indisponível.');
 const rendered=renderTransactionalEmail(template,{
  firstName:recipientName.trim().split(/\s+/)[0],company,email:recipientEmail,
  actionUrl,orderReference,amountCents,
  supportEmail:'contato@oryneo.com.br',
  whatsappUrl:'https://wa.me/5521974510932'
 });
 return await invokeMailAction<{internetMessageId:string;alreadyAccepted:boolean}>('send',{
  mailboxId:mailbox.id,idempotencyKey,
  to:[{address:recipientEmail.trim().toLowerCase(),name:recipientName.trim()}],
  cc:[],bcc:[],subject:rendered.subject,text:rendered.text,html:rendered.html,attachments:[]
 });
}
