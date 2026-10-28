import {createClient} from 'npm:@supabase/supabase-js@2.90.1';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://crm.oryneo.com.br','https://guilherme-freitas-oryneo.github.io','http://localhost:4175']);
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
 'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const send=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return send({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return send({error:'Método não permitido.'},405);
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
 const {data:{user}}=await db.auth.getUser(jwt);
 if(!user)return send({error:'Autenticação necessária.'},401);
 const {data:member,error:memberError}=await db.from('crm_members').select('user_id').eq('user_id',user.id).maybeSingle();
 if(memberError)return send({error:'Permissões indisponíveis.'},503);
 if(!member)return send({error:'Acesso não autorizado.'},403);
 let body:{request_id?:string;state?:string;note?:string};
 try{body=await req.json()}catch{return send({error:'Solicitação inválida.'},400)}
 if(typeof body.request_id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.request_id)
  ||!['in_review','fulfilled','rejected'].includes(body.state||'')
  ||(body.note||'').length>2000)return send({error:'Atualização inválida.'},422);
 const {data:result,error}=await db.rpc('crm_review_offboarding',{
  p_id:body.request_id,p_state:body.state,p_note:typeof body.note==='string'?body.note.trim():'',p_actor:user.id
 });
 if(error||!result?.ok)return send({error:'Não foi possível atualizar a revisão.'},503);
 return send({ok:true});
});
