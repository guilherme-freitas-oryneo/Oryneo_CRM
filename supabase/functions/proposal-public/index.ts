import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
 auth:{persistSession:false,autoRefreshToken:false}
});
const origins=new Set(['https://guilherme-freitas-oryneo.github.io','https://oryneo.com.br','https://www.oryneo.com.br','http://localhost:4175']);
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const emailValid=(s:string)=>s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Vary':'Origin','Cache-Control':'no-store','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return respond({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
 const max=8192;let raw='';
 try{raw=await req.text()}catch{return respond({error:'Corpo inválido.'},400)}
 if(raw.length>max)return respond({error:'Solicitação excede o limite.'},413);
 let body:{action?:string;token?:string;name?:string;email?:string;snapshot_sha256?:string;consent?:boolean};
 try{body=JSON.parse(raw)}catch{return respond({error:'Solicitação inválida.'},400)}
 const token=body.token||'';
 if(typeof token!=='string'||!/[A-Za-z0-9_-]{42,50}/.test(token)||token.length>50)
   return respond({error:'Link inválido.'},400);
 const tokenHash=await hash(token);
 const {data:proposal,error}=await db.from('crm_proposals')
  .select('id,deal_id,version,status,snapshot,snapshot_sha256,contact_email,customer_name,company,expires_at,accepted_at')
  .eq('public_token_hash',tokenHash).maybeSingle();
 if(error){console.error('Proposal lookup failed',{code:error.code});return respond({error:'Consulta indisponível.'},503)}
 if(!proposal)return respond({error:'Proposta não encontrada ou link inválido.'},404);
 if(body.action==='read'){
  const {data:latest,error:versionError}=await db.from('crm_proposals').select('version')
    .eq('deal_id',proposal.deal_id).order('version',{ascending:false}).limit(1).maybeSingle();
  if(versionError)return respond({error:'Não foi possível conferir a versão.'},503);
  const status=latest&&latest.version>proposal.version?'superseded':
    proposal.status==='sent'&&new Date(proposal.expires_at).getTime()<=Date.now()?'expired':proposal.status;
  return respond({ok:true,proposal:{
   version:proposal.version,status,company:proposal.company,customer_name:proposal.customer_name,
   contact_email:proposal.contact_email,expires_at:proposal.expires_at,accepted_at:proposal.accepted_at,
   snapshot:proposal.snapshot,snapshot_sha256:proposal.snapshot_sha256
  }});
 }
 if(body.action!=='accept')return respond({error:'Ação inválida.'},400);
 if(body.consent!==true)return respond({error:'Confirme que leu e aceitou os valores e ciclos de cobrança.'},422);
 const name=typeof body.name==='string'?body.name.trim():'';
 const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
 const givenHash=typeof body.snapshot_sha256==='string'?body.snapshot_sha256:'';
 if(name.length<2||name.length>180||!emailValid(email)||!/^[a-f0-9]{64}$/.test(givenHash))
  return respond({error:'Informe seu nome e e-mail e revise a proposta.'},422);
 const {data:accepted,error:acceptError}=await db.rpc('crm_accept_proposal',{
  p_token_hash:tokenHash,p_name:name,p_email:email,p_snapshot_sha256:givenHash
 });
 if(acceptError){console.error('Proposal accept failed',{code:acceptError.code});return respond({error:'Aceite indisponível.'},503)}
 if(!accepted?.ok){
  const reason=String(accepted?.reason||'');
  if(reason==='email_mismatch')return respond({error:'O e-mail não corresponde ao destinatário desta proposta.'},422);
  if(reason==='invalid_link')return respond({error:'Link inválido.'},404);
  return respond({error:'A proposta expirou ou foi substituída. Solicite o link atualizado.'},409);
 }
 return respond({ok:true,accepted:true,version:accepted.version,already_accepted:!!accepted.already_accepted});
});
