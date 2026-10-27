import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
import {buildBillingQuote} from '../_shared/billing/catalog.ts';
import {buildProposalPresentation} from '../_shared/billing/presentation.ts';
import {deterministicMailUuid,sendSystemTransactionalEmail} from '../_shared/mail/system-transactional.ts';
import { crmPublicUrl } from '../_shared/hosting/crm-urls.ts';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
 auth:{persistSession:false,autoRefreshToken:false}
});
const allowedOrigins=new Set(['https://crm.oryneo.com.br','https://guilherme-freitas-oryneo.github.io','https://oryneo.com.br','https://www.oryneo.com.br','http://localhost:4175']);
const destination=crmPublicUrl('/proposta/',Deno.env.get('ORYNEO_CRM_PUBLIC_BASE'));
const digest=async(input:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const token=()=>{const a=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};

Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(allowedOrigins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!allowedOrigins.has(origin))return response({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return response({error:'Método não permitido.'},405);
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 const {data:{user},error:authError}=await db.auth.getUser(jwt);
 if(authError||!user)return response({error:'Autenticação necessária.'},401);
 const {data:member,error:memberError}=await db.from('crm_members').select('user_id').eq('user_id',user.id).maybeSingle();
 if(memberError)return response({error:'Acesso indisponível.'},503);
 if(!member)return response({error:'Acesso não autorizado.'},403);
 let body:{deal_id?:string};
 try{body=await req.json()}catch{return response({error:'Solicitação inválida.'},400)}
 if(typeof body?.deal_id!=='string'||!/^[a-f0-9-]{36}$/i.test(body.deal_id))return response({error:'Oportunidade inválida.'},400);
 const {data:deal,error:dealError}=await db.from('crm_records').select('id,data').eq('id',body.deal_id).eq('kind','deal').eq('deleted',false).maybeSingle();
 if(dealError)return response({error:'Oportunidade indisponível.'},503);
 if(!deal)return response({error:'Oportunidade não encontrada.'},404);
 const data=deal.data as Record<string,unknown>;
 const quote=data.quote as {plan?:string;cycle?:string;addons?:Array<{key:string}>}|undefined;
 if(!quote?.plan||!quote?.cycle)return response({error:'A proposta comercial ainda não foi configurada.'},422);
 let computed:ReturnType<typeof buildBillingQuote>;
 const selected=(quote.addons||[]).map(a=>a.key);
 try{computed=buildBillingQuote({plan:quote.plan,cycle:quote.cycle,addons:selected})}
 catch{return response({error:'Reveja preços, plano e complementos no catálogo.'},422)}
 const email=String(data.email||'').trim().toLowerCase();
 const name=String(data.contact||'').trim();
 const company=String(data.company||data.title||'').trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||name.length<2||company.length<2)
  return response({error:'Complete o contato, o e-mail e a empresa antes de enviar a proposta.'},422);
 const submission=data.form_submission&&typeof data.form_submission==='object'&&!Array.isArray(data.form_submission)
  ?data.form_submission as Record<string,unknown>:{};
 const presentation=buildProposalPresentation(computed,typeof submission.primary_goal==='string'?submission.primary_goal:'');
 const snapshot={
  schema:'oryneo.proposal.v1',catalog_version:computed.catalogVersion,
  plan:computed.plan,cycle:computed.cycle,addons:[...new Set(selected)].sort(),
  items:computed.items.map(x=>({key:x.key,label:x.label,detail:x.detail,amount_cents:x.amountCents,recurring:x.recurring})),
  amount_total:computed.amountTotal,
  recurring:{label:computed.recurring.label,amount_cents:computed.recurring.amountCents,interval_label:computed.recurring.intervalLabel},
  traffic_renewal_amount_cents:selected.includes('traffic')?296970:null,
  traffic_renewal_interval:'a cada três meses, após os primeiros três meses',
  media_budget_included:false,
  presentation,
  notice:'O aceite confirma ciência da seleção comercial, do valor inicial e dos ciclos de cobrança exibidos. A formalização contratual e o processamento do pagamento são etapas independentes.'
 };
 const snapshotHash=await digest(JSON.stringify(snapshot));
 const publicToken=token();
 const {data:result,error:issueError}=await db.rpc('crm_issue_proposal',{
  p_deal_id:deal.id,p_by:user.id,p_token_hash:await digest(publicToken),
  p_snapshot:snapshot,p_snapshot_sha256:snapshotHash,p_contact_email:email,p_customer_name:name,p_company:company
 });
 if(issueError||!result?.ok){console.error('Proposal issue failed',{code:issueError?.code,reason:result?.reason});
  return response({error:'Não foi possível registrar a proposta versionada.'},503)}
 const proposalUrl=destination+'?token='+encodeURIComponent(publicToken);
 let emailSent=false;
 try{
  await sendSystemTransactionalEmail(db,{
   idempotencyKey:await deterministicMailUuid('proposal:'+result.id+':sent'),
   template:'proposal_sent',recipient:email,recipientName:name,
   data:{firstName:name.split(/\s+/)[0],company,email,plan:computed.plan,cycle:computed.cycle,
    orderReference:'PROPOSTA-'+String(result.version),amountCents:computed.amountTotal,
    actionUrl:proposalUrl,whatsappUrl:'https://wa.me/5521974510932',proposalPresentation:presentation}
  });
  emailSent=true;
 }catch(error){console.error('Proposal email delivery needs review',{proposal_id:result.id,code:error instanceof Error?error.message:'unknown'})}
 return response({ok:true,version:result.version,proposal_id:result.id,url:proposalUrl,email_sent:emailSent});
});
