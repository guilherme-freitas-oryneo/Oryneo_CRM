import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.90.1';
import { SupabaseMailDatabase } from '../mail/database.ts';
import { SmtpClient } from '../mail/transport.ts';
import { buildMimeMessage } from '../mail/mime.ts';

type Db = SupabaseClient<any,'public','public',any,any>;
type Order = {
 id:string; reference:string; customer_name:string; customer_email:string; company:string;
 status:string; paid_at:string|null; stripe_customer_id:string|null; stripe_subscription_id:string|null;
 stripe_traffic_subscription_id:string|null; amount_total:number;
 items:Array<{key:string;label:string;detail:string;amount_cents:number}>;
 selection:{plan:string;cycle:string;addons:string[]};
};

export const TRAFFIC_QUARTERLY_PRICE = 'price_1UQA2kCi4hhgz3b9IrEEF42i';
const STRIPE_VERSION = '2026-08-26.dahlia';
const format = (cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const firstName=(s:string)=>(s.trim().split(/\s+/)[0]||'cliente').slice(0,80);

async function stripeGet(path:string,secret:string):Promise<any>{
 const result=await fetch('https://api.stripe.com/v1'+path,{
   headers:{Authorization:'Bearer '+secret,'Stripe-Version':STRIPE_VERSION}
 });
 const body=await result.json();
 if(!result.ok)throw Error('STRIPE_READ_'+result.status+':'+(body.error?.code||'unknown'));
 return body;
}

export function threeMonthsAfter(iso:string):number{
 const start=new Date(iso);
 if(!Number.isFinite(start.getTime()))throw Error('INVALID_PAID_AT');
 const year=start.getUTCFullYear();
 const month=start.getUTCMonth()+3;
 const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
 const future=Date.UTC(year,month,Math.min(start.getUTCDate(),last),
   start.getUTCHours(),start.getUTCMinutes(),start.getUTCSeconds());
 return Math.floor(future/1000);
}

export async function getPaidOrder(db:Db,sessionId:string):Promise<Order|null>{
 const {data,error}=await db.from('crm_billing_orders').select('*')
    .eq('stripe_checkout_session_id',sessionId).maybeSingle();
 if(error)throw Error('ORDER_LOOKUP');
 return data?.status==='paid'?data as Order:null;
}

export async function ensureTrafficSubscription(db:Db,order:Order,stripeSecret:string):Promise<void>{
 if(!(order.selection.addons||[]).includes('traffic')||order.stripe_traffic_subscription_id)return;
 if(!order.paid_at||!order.stripe_customer_id||!order.stripe_subscription_id)
   throw Error('TRAFFIC_REQUIRES_VERIFIED_CHECKOUT');
 const anchor=threeMonthsAfter(order.paid_at);
 if(anchor <= Math.floor(Date.now()/1000)+86400*2)
   throw Error('TRAFFIC_RENEWAL_REQUIRES_REVIEW');

 const main=await stripeGet('/subscriptions/'+encodeURIComponent(order.stripe_subscription_id),stripeSecret);
 if(main.customer!==order.stripe_customer_id || !['active','trialing'].includes(main.status))
   throw Error('TRAFFIC_PARENT_SUBSCRIPTION_NOT_READY');

 let paymentMethod=typeof main.default_payment_method==='string'?main.default_payment_method
   : main.default_payment_method?.id||null;
 if(!paymentMethod){
   const pi=await stripeGet('/payment_intents?customer='+encodeURIComponent(order.stripe_customer_id)+'&limit=10',stripeSecret);
   const paid=(pi.data||[]).find((v:any)=>v.status==='succeeded'&&typeof v.payment_method==='string');
   paymentMethod=paid?.payment_method||null;
 }
 if(!paymentMethod)throw Error('TRAFFIC_PAYMENT_METHOD_UNAVAILABLE');

 const form=new URLSearchParams();
 form.set('customer',order.stripe_customer_id);
 form.set('items[0][price]',TRAFFIC_QUARTERLY_PRICE);
 form.set('items[0][quantity]','1');
 form.set('default_payment_method',paymentMethod);
 form.set('trial_end',String(anchor));
 form.set('trial_settings[end_behavior][missing_payment_method]','cancel');
 form.set('collection_method','charge_automatically');
 form.set('billing_mode[type]','flexible');
 form.set('metadata[oryneo_order_id]',order.id);
 form.set('metadata[oryneo_role]','traffic_quarterly');
 form.set('metadata[oryneo_primary_subscription]',order.stripe_subscription_id);
 const response=await fetch('https://api.stripe.com/v1/subscriptions',{
  method:'POST',
  headers:{Authorization:'Bearer '+stripeSecret,'Stripe-Version':STRIPE_VERSION,
    'Content-Type':'application/x-www-form-urlencoded',
    'Idempotency-Key':'oryneo-traffic-sub-'+order.id},
  body:form
 });
 const sub=await response.json();
 if(!response.ok||!sub.id||sub.customer!==order.stripe_customer_id)
   throw Error('TRAFFIC_SUBSCRIPTION_CREATE_'+response.status+':'+(sub.error?.code||'unknown'));
 const {error}=await db.from('crm_billing_orders').update({
    stripe_traffic_subscription_id:sub.id,
    traffic_next_charge_at:new Date(anchor*1000).toISOString(),
    traffic_subscription_status:sub.status,
    updated_at:new Date().toISOString()
 }).eq('id',order.id).is('stripe_traffic_subscription_id',null);
 if(error)throw Error('TRAFFIC_SUBSCRIPTION_LINK');
}

export function welcomeMarkup(order:Order):{subject:string;text:string;html:string}{
 const firstname=firstName(order.customer_name);
 const interval=order.selection.cycle==='annual'?'anual':'mensal';
 const plan=order.selection.plan;
 const subscriptionLine=order.items.find(x=>x.key.endsWith('_'+(order.selection.cycle==='annual'?'annual':'monthly')));
 const recurring=subscriptionLine?.amount_cents||0;
 const hasTraffic=(order.selection.addons||[]).includes('traffic');
 const hasLanding=(order.selection.addons||[]).includes('landing-page');
 const subject='Boas-vindas à ORYNEO, '+firstname+' — contratação confirmada';
 const lines=order.items.map(x=>x.label+' ('+x.detail+'): '+format(x.amount_cents)).join('\n');
 const text='Olá, '+firstname+'.\n\n'+
 'Sua contratação da ORYNEO para '+order.company+' foi confirmada.\n\n'+
 'Pedido: '+order.reference+'\n'+lines+'\nTotal inicial: '+format(order.amount_total)+'\n'+
 'Plano '+plan+' '+interval+': '+format(recurring)+(interval==='anual'?' por ano':' por mês')+'.\n'+
 (hasTraffic?'Tráfego: R$ 2.969,70 por trimestre. O primeiro trimestre foi pago na contratação; os próximos são cobrados trimestralmente. Verba de mídia paga à parte.\n':'')+
 (hasLanding?'Landing page incluída como projeto de cobrança única.\n':'')+
 '\nPróximos passos:\n1. Registro da contratação.\n2. Organização das informações para implantação.\n3. Orientações sobre alinhamentos e acessos conforme o escopo.\n\n'+
 'Em caso de dúvidas, responda a este e-mail.\nEquipe ORYNEO\nCrescimento em sistema.\n'+
 'Esta mensagem é transacional. Não solicitamos senhas ou dados completos de cartão.';
 const rows=order.items.map(x=>'<tr><td style="padding:12px 0;border-bottom:1px solid #eceef3"><strong style="color:#293041">'+esc(x.label)+
 '</strong><br><span style="font-size:12px;color:#818b9c">'+esc(x.detail)+'</span></td>'+
 '<td align="right" style="white-space:nowrap;border-bottom:1px solid #eceef3;color:#293041">'+esc(format(x.amount_cents))+'</td></tr>').join('');
 const extra=(hasLanding||hasTraffic)?'<div style="background:#f5f6fb;border-radius:10px;padding:17px;margin-top:25px;font-size:13px;color:#646e80;line-height:1.7">'+
 (hasLanding?'<strong>Landing page:</strong> contemplada na implantação conforme a proposta.<br>':'')+
 (hasTraffic?'<strong>Tráfego pago:</strong> cobrança recorrente trimestral de R$ 2.969,70. Verba de mídia separada.':'')+'</div>':'';
 const html='<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'+
 '<body style="margin:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#252b36">'+
 '<div style="display:none;max-height:0;overflow:hidden">Sua contratação foi confirmada. Veja o resumo e os próximos passos.</div>'+
 '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f5f8"><tr><td align="center" style="padding:25px 12px">'+
 '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#fff">'+
 '<tr><td style="background:#181d28;color:#fff;padding:30px 34px 36px"><div style="font-size:23px;font-weight:800;letter-spacing:3px">ORYNEO<span style="color:#8693fa">.</span></div>'+
 '<p style="color:#bfc8ff;font-size:11px;letter-spacing:2px;margin-top:40px">CONTRATAÇÃO CONFIRMADA</p>'+
 '<h1 style="font-size:31px;letter-spacing:-1px;line-height:1.2;margin:15px 0">O próximo passo da sua operação começa aqui.</h1>'+
 '<p style="color:#bdc5d2;font-size:14px;line-height:1.7">Uma parceria para estruturar o que vem pela frente.</p></td></tr>'+
 '<tr><td style="padding:35px 34px"><h2 style="font-size:20px">Olá, '+esc(firstname)+'.</h2>'+
 '<p style="color:#636d7e;font-size:14px;line-height:1.8">É um prazer receber você na ORYNEO. Confirmamos a contratação de <strong>'+esc(order.company)+'</strong>. Nossa equipe organizará as próximas etapas de implantação.</p>'+
 '<p style="font-size:11px;color:#737bd3;letter-spacing:1px;margin-top:30px">RESUMO DA CONTRATAÇÃO · '+esc(order.reference)+'</p>'+
 '<h2 style="font-size:20px">Plano '+esc(plan)+' · '+esc(interval)+'</h2>'+
 '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">'+rows+'</table>'+
 '<p style="background:#eef0ff;padding:15px;border-radius:8px;color:#3e479d"><span>Total inicial</span><strong style="float:right">'+esc(format(order.amount_total))+'</strong></p>'+
 '<p style="font-size:12px;color:#777f8f;line-height:1.6">Assinatura do plano: '+esc(format(recurring))+(interval==='anual'?' por ano':' por mês')+'. Condições detalhadas na proposta.</p>'+
 extra+
 '<h2 style="margin-top:34px;font-size:20px">O que acontece agora?</h2>'+
 '<p style="color:#656f7f;font-size:14px;line-height:1.85"><strong>01.</strong> Contratação registrada.<br><strong>02.</strong> Preparação e alinhamento da implantação.<br><strong>03.</strong> Próximas instruções para a equipe.</p>'+
 '<p style="color:#656f7f;font-size:14px;line-height:1.75;margin-top:27px">Dúvidas? Basta responder a esta mensagem.<br><strong>Equipe ORYNEO</strong> · Crescimento em sistema.</p>'+
 '</td></tr><tr><td style="background:#f5f6f8;padding:22px 34px;color:#8e96a4;font-size:11px;line-height:1.6">'+
 'Mensagem transacional referente à sua contratação. A ORYNEO não solicita senhas ou dados completos de cartão por e-mail.</td></tr>'+
 '</table></td></tr></table></body></html>';
 return {subject,text,html};
}

export async function sendWelcomeTestSafe(db:Db,order:Order):Promise<'sent'|'suppressed'|'skipped'>{
 const {data:row,error:loadError}=await db.from('crm_billing_welcome')
    .select('state,attempts').eq('order_id',order.id).maybeSingle();
 if(loadError||!row||row.state!=='pending')return 'skipped';
 const internal=/^[^\s@]+@oryneo\.com\.br$/i.test(order.customer_email);
 if(!internal){
    await db.from('crm_billing_welcome').update({
      state:'suppressed_test',last_error:'TEST_MODE_EXTERNAL_RECIPIENT_NOT_SENT',updated_at:new Date().toISOString()
    }).eq('order_id',order.id).eq('state','pending');
    return 'suppressed';
 }
 // Claim at most once: nunca reenviar sem auditoria do histórico de Message-ID.
 const msgId='<oryneo-welcome-'+order.id+'@oryneo.com.br>';
 const {data:claimed,error:claimError}=await db.from('crm_billing_welcome').update({
   state:'sending',attempts:row.attempts+1,internet_message_id:msgId,updated_at:new Date().toISOString()
 }).eq('order_id',order.id).eq('state','pending').select('order_id').maybeSingle();
 if(claimError||!claimed)return 'skipped';
 try{
   const {data:mailbox,error:mailError}=await db.from('crm_mailboxes').select('id,address')
     .eq('address','contato@oryneo.com.br').eq('active',true).maybeSingle();
   if(mailError||!mailbox)throw Error('WELCOME_MAILBOX_UNAVAILABLE');
   const database=new SupabaseMailDatabase(db);
   const credentials=await database.getCredentials(mailbox.id);
   const template=welcomeMarkup(order);
   const raw=await buildMimeMessage({messageId:msgId,from:{address:credentials.address,name:'Equipe ORYNEO'},
     to:[{address:order.customer_email,name:order.customer_name}],
     subject:template.subject,text:template.text,html:template.html});
   const smtp=new SmtpClient({host:credentials.smtpHost,port:credentials.smtpPort,
     username:credentials.address,password:credentials.password});
   await smtp.send({from:credentials.address,recipients:[order.customer_email],raw});
   const {error:updateError}=await db.from('crm_billing_welcome').update({
      state:'sent',sent_at:new Date().toISOString(),updated_at:new Date().toISOString()
   }).eq('order_id',order.id).eq('state','sending');
   if(updateError)throw Error('WELCOME_RECEIPT_WRITE');
   return 'sent';
 }catch(err){
   // Se houve aceite SMTP e falhou a gravação, não tentar envio automático de novo.
   await db.from('crm_billing_welcome').update({
     state:'failed',last_error:err instanceof Error?err.message:'WELCOME_FAILURE',
     updated_at:new Date().toISOString()
   }).eq('order_id',order.id).eq('state','sending');
   throw err;
 }
}
