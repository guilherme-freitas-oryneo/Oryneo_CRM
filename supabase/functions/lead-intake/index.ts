import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { clean, digits, normalizeIntakePayload, normalizedCnpj } from '../_shared/intake/contract.ts';
const origins = new Set(['https://oryneo-lp-preview.guilherme-frei160023.chatgpt.site','https://oryneo.com.br','https://www.oryneo.com.br','https://guilherme-freitas-oryneo.github.io']);
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const safeText=(v:unknown,max=180)=>clean(v,max);
function companyProfile(data:Record<string,unknown>){
 const qsa=Array.isArray(data.qsa)?data.qsa.slice(0,40).map((s:Record<string,unknown>)=>({
  name:safeText(s?.nome_socio,170),qualification:safeText(s?.qualificacao_socio,90),joined_at:safeText(s?.data_entrada_sociedade,25)
 })).filter((s:{name:string})=>s.name):[];
 return {
  legal_name:safeText(data.razao_social),trade_name:safeText(data.nome_fantasia),
  status:safeText(data.descricao_situacao_cadastral,90),opened_at:safeText(data.data_inicio_atividade,25),
  capital:typeof data.capital_social==='number'&&Number.isFinite(data.capital_social)?data.capital_social:null,
  legal_form:safeText(data.natureza_juridica),main_activity:safeText(data.cnae_fiscal_descricao),
  main_cnae:safeText(data.cnae_fiscal,30),
  address:{street:safeText(data.logradouro),number:safeText(data.numero,35),complement:safeText(data.complemento,140),district:safeText(data.bairro),city:safeText(data.municipio),state:safeText(data.uf,2),zip:digits(data.cep).slice(0,8)},
  email:safeText(data.email,254).toLowerCase(),phone:safeText(data.ddd_telefone_1,40),secondary_phone:safeText(data.ddd_telefone_2,40),qsa
 };
}
async function lookupCnpj(cnpj:string):Promise<{profile:ReturnType<typeof companyProfile>|null;notFound:boolean}>{
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),7500);
 try {
  const r=await fetch('https://brasilapi.com.br/api/cnpj/v1/'+cnpj,{signal:controller.signal,headers:{Accept:'application/json'}});
  if(r.status===404)return {profile:null,notFound:true};
  if(!r.ok)return {profile:null,notFound:false};
  const j=await r.json();
  if(!j||typeof j!=='object'||normalizedCnpj(j.cnpj)!==cnpj)return {profile:null,notFound:false};
  return {profile:companyProfile(j),notFound:false};
 }catch{return {profile:null,notFound:false}}finally{clearTimeout(timeout)}
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Vary':'Origin','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Cache-Control':'no-store'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return response({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return response({error:'Método não permitido.'},405);
 try{
  const claimed=Number(req.headers.get('content-length')||0);
  if(claimed>20000)return response({error:'Solicitação muito longa.'},413);
  const reader=req.body?.getReader();if(!reader)return response({error:'Solicitação inválida.'},400);
  let size=0;const chunks:Uint8Array[]=[];
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>20000){await reader.cancel();return response({error:'Solicitação muito longa.'},413)}chunks.push(part.value)}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length}
  const body=JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>;
  if(body.website)return response({ok:true});
  let normalized:ReturnType<typeof normalizeIntakePayload>;
  try{normalized=normalizeIntakePayload(body)}catch{return response({error:'Confira os dados da solicitação e tente novamente.'},400)}
  const lookup=normalized.cnpj?await lookupCnpj(normalized.cnpj):null;
  if(!lookup)return response({error:'Informe um CNPJ válido para continuar.'},400);
  if(lookup.notFound)return response({error:'Não encontramos esse CNPJ. Confira os números e tente novamente.'},422);
  if(!lookup.profile)return response({error:'Não foi possível consultar o CNPJ agora. Tente novamente em instantes.'},503);
  const profile=lookup.profile;
  const company=profile.trade_name||profile.legal_name||normalized.cnpj;
  const fingerprint=await digest(digits(normalized.phone)+Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const record={
   title:('Solicitação · '+company).slice(0,160),company,contact:normalized.contact,email:normalized.email,phone:normalized.phone,
   company_cnpj:normalized.cnpj||null,company_profile:profile||{},quote:normalized.quote,
   value_cents:normalized.quote?.first_charge_cents??0,form_submission:normalized.formSubmission,
   notes:normalized.summary+'\n\nConsentimento de contato registrado em '+new Date().toISOString()+'.',
   due_date:''
  };
  const {error}=await db.rpc('crm_intake',{p_request_id:normalized.requestId,p_fingerprint:fingerprint,p_data:record});
  if(error)return response({error:error.message.includes('Muitas solicitações')?'Muitas solicitações. Tente novamente mais tarde.':'Não foi possível registrar agora. Tente novamente.'},error.message.includes('Muitas solicitações')?429:503);
  return response({ok:true});
 }catch{return response({error:'Solicitação inválida.'},400)}
});
