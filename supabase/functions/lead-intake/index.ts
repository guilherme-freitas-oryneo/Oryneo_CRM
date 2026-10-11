import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
const origins = new Set(['https://oryneo-lp-preview.guilherme-frei160023.chatgpt.site','https://oryneo.com.br','https://www.oryneo.com.br','https://guilherme-freitas-oryneo.github.io']);
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
const catalog={Start:{monthly:74990,setup:98990,users:5},Growth:{monthly:109990,setup:138990,users:10},Scale:{monthly:147990,setup:184990,users:20}} as const;
const additions={'landing-page':{label:'Landing page de conversão',amount:88990,billing:'one_time'},traffic:{label:'Gestão de tráfego pago',amount:98990,billing:'monthly',minimumMonths:3}} as const;
type Plan=keyof typeof catalog;
type Addon=keyof typeof additions;
const clean=(s:unknown,max=200)=>typeof s==='string'?s.trim().slice(0,max):'';
const digits=(v:unknown)=>clean(v,50).replace(/\D/g,'');
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
async function lookupCnpj(cnpj:string){
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),7500);
 try {
  const r=await fetch('https://brasilapi.com.br/api/cnpj/v1/'+cnpj,{signal:controller.signal,headers:{Accept:'application/json'}});
  if(!r.ok)return null;
  const j=await r.json();
  if(!j||typeof j!=='object'||digits(j.cnpj)!==cnpj)return null;
  return companyProfile(j);
 }catch{return null}finally{clearTimeout(timeout)}
}
function quoteSelection(input:Record<string,unknown>){
 const plan=clean(input.plan,25),cycle=clean(input.cycle,20)||'monthly';
 const services=input.services??[];
 if(!Array.isArray(services)||services.length>2||services.some(x=>typeof x!=='string'))throw new Error('Complementos inválidos.');
 const ids=[...new Set(services)];
 if(ids.some(x=>!Object.prototype.hasOwnProperty.call(additions,x)))throw new Error('Serviço não reconhecido.');
 if(!plan){if(ids.length)throw new Error('Selecione um plano.');return null}
 if(!Object.prototype.hasOwnProperty.call(catalog,plan)||!['monthly','annual'].includes(cycle))throw new Error('Plano ou ciclo inválido.');
 const selected=catalog[plan as Plan],cycleCharge=cycle==='annual'?Math.round(selected.monthly*12*0.9):selected.monthly;
 const servicesQuote=ids.map(x=>{
  const i=x as Addon,info=additions[i];
  return {key:i,label:info.label,billing:info.billing,amount_cents:info.amount,upfront_cents:info.amount*('minimumMonths'in info?info.minimumMonths:1)};
 });
 const addonsCents=servicesQuote.reduce((sum,i)=>sum+i.upfront_cents,0);
 return {plan,cycle,monthly_cents:selected.monthly,period_cents:cycleCharge,setup_cents:selected.setup,addons:servicesQuote,first_charge_cents:cycleCharge+selected.setup+addonsCents,users:selected.users,catalog_version:'2026-10-11'};
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
  const contact=clean(body.contact,160),phone=clean(body.phone,40),email=clean(body.email,254).toLowerCase();
  if(body.consent!==true||contact.length<2||!/^\S+@\S+\.\S+$/.test(email)||digits(phone).length<10||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body.request_id||'')))return response({error:'Confira seus dados e autorize o contato.'},400);
  let quote:ReturnType<typeof quoteSelection>;
  try{quote=quoteSelection(body)}catch(e){return response({error:String(e instanceof Error?e.message:'Seleção inválida.')},400)}
  const cnpj=digits(body.cnpj);const intent=clean(body.intent,30)||'conversation';
  if(intent==='contract'&&cnpj.length!==14)return response({error:'Informe um CNPJ válido para contratar.'},400);
  if(cnpj&&cnpj.length!==14)return response({error:'Confira o CNPJ informado.'},400);
  const profile=cnpj?await lookupCnpj(cnpj):null;
  const company=clean(body.company,160)||profile?.trade_name||profile?.legal_name||contact;
  const fingerprint=await digest(digits(phone)+Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const goals=Array.isArray(body.goals)?body.goals.filter(x=>typeof x==='string').slice(0,12).map(x=>clean(x,120)):[];
  const summary=clean(body.summary,11000);
  const quoteTotal=quote?.first_charge_cents??0;
  const record={
   title:('Solicitação · '+company).slice(0,160),company,contact,email,phone,
   company_cnpj:cnpj||null,company_profile:profile||{},quote:quote||null,
   value_cents:quoteTotal,form_submission:{intent,goals,team_size:clean(body.team_size,70),acquisition_channel:clean(body.acquisition_channel,120)},
   notes:summary+'\n\nConsentimento de contato registrado em '+new Date().toISOString()+'.',
   due_date:''
  };
  const {error}=await db.rpc('crm_intake',{p_request_id:body.request_id,p_fingerprint:fingerprint,p_data:record});
  if(error)return response({error:error.message.includes('Muitas solicitações')?'Muitas solicitações. Tente novamente mais tarde.':'Não foi possível registrar agora. Tente novamente.'},error.message.includes('Muitas solicitações')?429:503);
  return response({ok:true});
 }catch{return response({error:'Solicitação inválida.'},400)}
});