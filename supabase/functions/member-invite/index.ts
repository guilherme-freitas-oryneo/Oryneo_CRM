import {createClient} from 'npm:@supabase/supabase-js@2.90.1';

const url=Deno.env.get('SUPABASE_URL')!;
const db=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://guilherme-freitas-oryneo.github.io','https://oryneo.com.br','https://www.oryneo.com.br']);
const roles=new Set(['admin','commercial','support','viewer']);

Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return respond({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
 if(!jwt)return respond({error:'Autenticação necessária.'},401);
 const {data:{user},error:authError}=await db.auth.getUser(jwt);
 if(authError||!user)return respond({error:'Autenticação inválida.'},401);
 const {data:admin,error:memberError}=await db.from('crm_members').select('role,status').eq('user_id',user.id).maybeSingle();
 if(memberError||admin?.role!=='admin'||admin?.status!=='active')return respond({error:'Acesso não autorizado.'},403);

 let body:Record<string,unknown>;
 try{body=await req.json()}catch{return respond({error:'Dados inválidos.'},400)}
 const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
 const name=typeof body.name==='string'?body.name.trim().slice(0,120):'';
 const role=typeof body.role==='string'?body.role:'';
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!roles.has(role))return respond({error:'E-mail ou papel inválido.'},400);
 const {data:member}=await db.from('crm_members').select('user_id').eq('directory_email',email).maybeSingle();
 if(member)return respond({error:'Esta pessoa já está na equipe.'},409);

 let targetId:string|undefined;
 for(let page=1;page<=100;page++){
  const {data,error}=await db.auth.admin.listUsers({page,perPage:1000});
  if(error)return respond({error:'Não foi possível conferir a conta.'},503);
  targetId=data.users.find(candidate=>candidate.email?.toLowerCase()===email)?.id;
  if(targetId||data.users.length<1000)break;
 }
 let invited=false;
 if(!targetId){
  const {data,error}=await db.auth.admin.inviteUserByEmail(email,{redirectTo:'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/'});
  if(error||!data.user)return respond({error:'Não foi possível enviar o convite. Confira o endereço e tente novamente.'},503);
  targetId=data.user.id;invited=true;
 }
 const {error:insertError}=await db.from('crm_members').insert({user_id:targetId,role,status:'active',directory_email:email,display_name:name||null});
 if(insertError)return respond({error:'A conta foi criada, mas o vínculo com a equipe falhou. Tente novamente.'},503);
 return respond({ok:true,invited});
});
