import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
const url=Deno.env.get('SUPABASE_URL')!;
const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://guilherme-freitas-oryneo.github.io','https://oryneo.com.br','https://www.oryneo.com.br']);
const text=(x:unknown,n=180)=>typeof x==='string'?x.trim().slice(0,n):'';
const digits=(x:unknown)=>text(x,40).replace(/\D/g,'');
const normalizedCnpj=(x:unknown)=>text(x,40).toUpperCase().replace(/[^A-Z0-9]/g,'');
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const respond=(x:unknown,status=200)=>new Response(JSON.stringify(x),{status,headers});
 if(origin&&!origins.has(origin))return respond({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
 if(!jwt)return respond({error:'Autenticação necessária.'},401);
 const {data:{user},error:authError}=await db.auth.getUser(jwt);
 if(authError||!user)return respond({error:'Autenticação inválida.'},401);
 const {data:member,error:membershipError}=await db.from('crm_members').select('user_id').eq('user_id',user.id).maybeSingle();
 if(membershipError||!member)return respond({error:'Acesso não autorizado.'},403);
 let body:Record<string,unknown>;
 try{body=await req.json()}catch{return respond({error:'Solicitação inválida.'},400)}
 const cnpj=normalizedCnpj(body.cnpj);
 if(cnpj.length!==14)return respond({error:'CNPJ inválido.'},400);
 const dealId=text(body.deal_id,40);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealId))return respond({error:'Oportunidade inválida.'},400);
 const userDb=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:allowed,error:scopeError}=await userDb.rpc('crm_can_enrich',{p_deal_id:dealId,p_cnpj:cnpj});
 if(scopeError||!allowed)return respond({error:'Acesso não autorizado.'},403);
 const {data:cached}=await db.from('crm_companies').select('profile,enriched_at,legal_name').eq('cnpj',cnpj).maybeSingle();
 if(cached?.profile&&Object.keys(cached.profile).length>0&&cached.enriched_at&&Date.now()-new Date(cached.enriched_at).getTime()<24*60*60*1000)return respond({ok:true,updated:false});
 const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),7500);
 let data:Record<string,unknown>;
 try{
  const r=await fetch('https://brasilapi.com.br/api/cnpj/v1/'+cnpj,{signal:ctrl.signal,headers:{Accept:'application/json'}});
  if(!r.ok)return respond({error:'Cadastro empresarial temporariamente indisponível.'},503);
  data=await r.json();
  if(normalizedCnpj(data.cnpj)!==cnpj)return respond({error:'Dados cadastrais não correspondem ao CNPJ.'},503);
 }catch{return respond({error:'Consulta cadastral temporariamente indisponível.'},503)}
 finally{clearTimeout(timeout)}
 const profile={
  legal_name:text(data.razao_social),trade_name:text(data.nome_fantasia),status:text(data.descricao_situacao_cadastral,90),
  opened_at:text(data.data_inicio_atividade,25),capital:typeof data.capital_social==='number'?data.capital_social:null,
  legal_form:text(data.natureza_juridica),main_activity:text(data.cnae_fiscal_descricao),main_cnae:text(data.cnae_fiscal,30),
  email:text(data.email,254).toLowerCase(),phone:text(data.ddd_telefone_1,40),secondary_phone:text(data.ddd_telefone_2,40),
  address:{street:text(data.logradouro),number:text(data.numero,35),complement:text(data.complemento,140),district:text(data.bairro),city:text(data.municipio),state:text(data.uf,2),zip:digits(data.cep).slice(0,8)},
  qsa:(Array.isArray(data.qsa)?data.qsa:[]).slice(0,40).map((item:Record<string,unknown>)=>({name:text(item?.nome_socio,170),qualification:text(item?.qualificacao_socio,90),joined_at:text(item?.data_entrada_sociedade,25)})).filter((item:{name:string})=>item.name)
 };
 const {error}=await db.from('crm_companies').upsert({cnpj,legal_name:profile.legal_name||cached?.legal_name||'',profile,enriched_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'cnpj'});
 if(error)return respond({error:'Não foi possível atualizar o cadastro.'},503);
 return respond({ok:true,updated:true});
});
