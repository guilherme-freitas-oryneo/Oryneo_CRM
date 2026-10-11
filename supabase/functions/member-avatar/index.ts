import {createClient} from 'npm:@supabase/supabase-js@2.90.1';

const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=new Set(['https://guilherme-freitas-oryneo.github.io','https://oryneo.com.br','https://www.oryneo.com.br']);
const bucket='crm-avatars';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const headers:Record<string,string>={'Content-Type':'application/json','Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 if(origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.has(origin))return respond({error:'Origem não autorizada.'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return respond({error:'Método não permitido.'},405);
 if(Number(req.headers.get('content-length')||0)>250000)return respond({error:'Imagem muito grande.'},413);
 const jwt=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
 if(!jwt)return respond({error:'Autenticação necessária.'},401);
 const {data:{user},error:authError}=await db.auth.getUser(jwt);
 if(authError||!user)return respond({error:'Autenticação inválida.'},401);
 const {data:member,error:memberError}=await db.from('crm_members').select('role,status').eq('user_id',user.id).maybeSingle();
 if(memberError||member?.status!=='active')return respond({error:'Acesso não autorizado.'},403);
 let body:Record<string,unknown>;
 try{
  const reader=req.body?.getReader();if(!reader)return respond({error:'Dados inválidos.'},400);
  let size=0;const chunks:Uint8Array[]=[];
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>250000){await reader.cancel();return respond({error:'Imagem muito grande.'},413)}chunks.push(part.value)}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length}
  body=JSON.parse(new TextDecoder().decode(bytes)) as Record<string,unknown>;
  if(!body||typeof body!=='object'||Array.isArray(body))return respond({error:'Dados inválidos.'},400);
 }catch{return respond({error:'Dados inválidos.'},400)}

 if(body.action==='read'){
  const ids=Array.isArray(body.user_ids)?body.user_ids.filter((id):id is string=>typeof id==='string'&&uuid.test(id)).slice(0,100):[];
  if(ids.length===0)return respond({urls:{}});
  if(member.role!=='admin'&&ids.some(id=>id!==user.id))return respond({error:'Acesso não autorizado.'},403);
  const {data:people,error}=await db.from('crm_members').select('user_id,avatar_path').in('user_id',ids);
  if(error)return respond({error:'Fotos indisponíveis.'},503);
  const urls:Record<string,string>={};
  await Promise.all((people||[]).filter(person=>person.avatar_path).map(async person=>{
   const {data}=await db.storage.from(bucket).createSignedUrl(person.avatar_path,1800);
   if(data?.signedUrl)urls[person.user_id]=data.signedUrl;
  }));
  return respond({urls});
 }
 if(body.action!=='upload'||typeof body.image!=='string'||body.image.length>180000)return respond({error:'Imagem inválida.'},400);
 const match=/^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(body.image);
 if(!match)return respond({error:'Formato inválido.'},400);
 let bytes:Uint8Array;
 try{bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0))}catch{return respond({error:'Imagem inválida.'},400)}
 if(bytes.length<100||bytes.length>131072)return respond({error:'A foto precisa ter até 128 KB.'},400);
 const format=match[1];
 const valid=format==='webp'?String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP':
  format==='png'?bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
 if(!valid)return respond({error:'Arquivo de imagem inválido.'},400);
 const {error:bucketError}=await db.storage.getBucket(bucket);
 if(bucketError){
  const {error:createError}=await db.storage.createBucket(bucket,{public:false,fileSizeLimit:131072,allowedMimeTypes:['image/webp','image/png','image/jpeg']});
  if(createError){const {error:retryError}=await db.storage.getBucket(bucket);if(retryError)return respond({error:'Armazenamento indisponível.'},503)}
 }
 const path=`${user.id}/avatar.${format==='jpeg'?'jpg':format}`;
 const safeBytes=new Uint8Array(bytes.length);safeBytes.set(bytes);
 const {error:uploadError}=await db.storage.from(bucket).upload(path,new Blob([safeBytes],{type:`image/${format}`}),{upsert:true,contentType:`image/${format}`,cacheControl:'60'});
 if(uploadError)return respond({error:'Não foi possível salvar a foto.'},503);
 const {error:updateError}=await db.from('crm_members').update({avatar_path:path,updated_at:new Date().toISOString()}).eq('user_id',user.id);
 if(updateError)return respond({error:'Foto enviada, mas perfil não atualizado.'},503);
 const {data:signed}=await db.storage.from(bucket).createSignedUrl(path,1800);
 return respond({ok:true,url:signed?.signedUrl||null});
});
