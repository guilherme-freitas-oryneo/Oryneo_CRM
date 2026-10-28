import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { requestAiReply, type AiMessage, type AiProvider } from '../_shared/whatsapp/aiProvider.ts';

const url=Deno.env.get('SUPABASE_URL')??'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value)?value:'';
const maxAttachmentBytes=20*1024*1024;
const allowedAttachmentTypes=new Set(['text/plain','text/markdown','text/csv','application/json','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const trainingFields=['business_context','tone','objective','qualification_questions','guardrails','handoff_rule'] as const;
const trainingDefaults={business_context:'Use o treinamento geral como fonte principal de contexto.',tone:'Leve, direto e humano.',objective:'Entender o contexto e encaminhar para o próximo passo.',qualification_questions:'Faça uma pergunta por vez.',guardrails:'Não invente informações.',handoff_rule:'Transfira quando for necessário atendimento humano.'};
const trainingConfig=(value:unknown)=>{
  const source=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};const result:Record<string,string>={};
  for(const field of trainingFields){const text=typeof source[field]==='string'?source[field].trim():trainingDefaults[field];if(text.length<5||text.length>4000)return null;result[field]=text;}
  return result;
};
const trainedPrompt=(base:string,training:Record<string,string>)=>`${base}\n\nCONTEXTO DO NEGÓCIO\n${training.business_context}\n\nTOM DE VOZ\n${training.tone}\n\nOBJETIVO\n${training.objective}\n\nPERGUNTAS DE QUALIFICAÇÃO\n${training.qualification_questions}\n\nREGRAS\n${training.guardrails}\n\nTRANSFERÊNCIA PARA HUMANO\n${training.handoff_rule}`;

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return json({error:'Método inválido.'},405);
  const bearer=req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!bearer)return json({error:'Autenticação necessária.'},401);
  const {data:auth,error:authError}=await db.auth.getUser(bearer);
  if(authError||!auth.user)return json({error:'Sessão inválida.'},401);
  let input:Record<string,unknown>;let multipartForm:FormData|null=null;
  try{
    if(req.headers.get('Content-Type')?.includes('multipart/form-data')){multipartForm=await req.formData();input=Object.fromEntries(multipartForm.entries());}
    else input=await req.json();
  }catch{return json({error:'Dados inválidos.'},400);}
  const {data:channel}=await db.from('crm_wa_channels').select('id').eq('display_phone_number','+5521974510932').maybeSingle();
  if(!channel)return json({error:'Canal do WhatsApp não encontrado.'},404);
  const {data:admin}=await db.from('crm_wa_access').select('id').eq('user_id',auth.user.id).eq('channel_id',channel.id).is('conversation_id',null).eq('role','admin').maybeSingle();
  const action=input.action;
  if(action==='get'){
    if(!admin)return json({error:'Ajustes restritos ao administrador.'},403);
    const [{data,error},{data:attachments,error:attachmentsError},queuedJobs,retryingJobs,retryingSends,uncertainSends,reviewJobs,reviewSends]=await Promise.all([
      db.from('crm_wa_ai_settings').select('provider,model,mode,system_prompt,training_prompt,training_config,api_key_last_four,updated_at').eq('channel_id',channel.id).maybeSingle(),
      db.from('crm_wa_ai_attachments').select('id,file_name,mime_type,size_bytes,created_at').eq('channel_id',channel.id).order('created_at',{ascending:false}),
      db.from('crm_wa_ai_jobs').select('id',{count:'exact',head:true}).eq('channel_id',channel.id).in('state',['queued','leased']),
      db.from('crm_wa_ai_jobs').select('id',{count:'exact',head:true}).eq('channel_id',channel.id).eq('state','retry_wait'),
      db.from('crm_wa_ai_outbox').select('id,crm_wa_ai_jobs!inner(channel_id)',{count:'exact',head:true}).eq('crm_wa_ai_jobs.channel_id',channel.id).eq('state','retry_wait'),
      db.from('crm_wa_ai_outbox').select('id,crm_wa_ai_jobs!inner(channel_id)',{count:'exact',head:true}).eq('crm_wa_ai_jobs.channel_id',channel.id).eq('state','uncertain'),
      db.from('crm_wa_ai_jobs').select('id',{count:'exact',head:true}).eq('channel_id',channel.id).eq('state','human_review'),
      db.from('crm_wa_ai_outbox').select('id,crm_wa_ai_jobs!inner(channel_id)',{count:'exact',head:true}).eq('crm_wa_ai_jobs.channel_id',channel.id).eq('state','human_review'),
    ]);
    const healthQueries=[queuedJobs,retryingJobs,retryingSends,uncertainSends,reviewJobs,reviewSends];
    return error||attachmentsError||healthQueries.some(result=>result.error)
      ?json({error:'Não foi possível carregar os ajustes.'},503)
      :json({ok:true,settings:{...(data??{provider:'openai',model:'gpt-5-mini',mode:'off',system_prompt:'',training_prompt:'',training_config:{},api_key_last_four:null}),attachments:attachments??[],health:{queued:queuedJobs.count??0,retrying:(retryingJobs.count??0)+(retryingSends.count??0),uncertain:uncertainSends.count??0,human_review:(reviewJobs.count??0)+(reviewSends.count??0)}}});
  }
  if(action==='save'){
    if(!admin)return json({error:'Ajustes restritos ao administrador.'},403);
    const provider=input.provider==='anthropic'?'anthropic':input.provider==='openai'?'openai':'';
    const model=typeof input.model==='string'?input.model.trim():'';
    const mode=['off','suggest','auto'].includes(String(input.mode))?String(input.mode):'';
    const systemPrompt=typeof input.systemPrompt==='string'?input.systemPrompt.trim():'';
    const training=trainingConfig(input.trainingConfig);
    const trainingPrompt=typeof input.trainingPrompt==='string'?input.trainingPrompt.trim():'';
    const apiKey=typeof input.apiKey==='string'?input.apiKey.trim():'';
    if(!provider||!model||model.length>100||!mode||systemPrompt.length<40||systemPrompt.length>5000||trainingPrompt.length<40||trainingPrompt.length>20000||!training)return json({error:'Revise o provedor, o modelo e o treinamento do SDR.'},400);
    const {data:existing}=await db.from('crm_wa_ai_settings').select('api_secret_id').eq('channel_id',channel.id).maybeSingle();
    if(mode!=='off'&&!apiKey&&!existing?.api_secret_id)return json({error:'Informe uma chave de API antes de ativar a IA.'},400);
    const {error}=await db.from('crm_wa_ai_settings').upsert({channel_id:channel.id,provider,model,mode,system_prompt:systemPrompt,training_prompt:trainingPrompt,training_config:training,updated_by:auth.user.id,updated_at:new Date().toISOString()});
    if(error)return json({error:'Não foi possível salvar os ajustes.'},503);
    if(apiKey){const stored=await db.rpc('crm_wa_ai_store_secret',{p_channel_id:channel.id,p_secret:apiKey});if(stored.error)return json({error:'Não foi possível proteger a chave de API.'},503);}
    return json({ok:true});
  }
  if(action==='upload'||action==='remove'){
    if(!admin)return json({error:'Ajustes restritos ao administrador.'},403);
    if(action==='remove'){
      const attachmentId=uuid(input.attachmentId);
      if(!attachmentId)return json({error:'Anexo inválido.'},400);
      const {data:attachment}=await db.from('crm_wa_ai_attachments').select('storage_path').eq('id',attachmentId).eq('channel_id',channel.id).maybeSingle();
      if(!attachment)return json({error:'Anexo não encontrado.'},404);
      await db.storage.from('crm-wa-ai-attachments').remove([attachment.storage_path]);
      const {error}=await db.from('crm_wa_ai_attachments').delete().eq('id',attachmentId).eq('channel_id',channel.id);
      return error?json({error:'Não foi possível remover o anexo.'},503):json({ok:true});
    }
    const file=multipartForm?.get('file');
    if(!(file instanceof File)||!file.size||file.size>maxAttachmentBytes||!allowedAttachmentTypes.has(file.type))return json({error:'Anexo inválido. Use TXT, Markdown, CSV, JSON, PDF ou DOCX de até 20 MB.'},400);
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,'_').slice(-180);const path=`${channel.id}/${crypto.randomUUID()}-${safeName}`;
    const bytes=new Uint8Array(await file.arrayBuffer());let extracted='';
    if(file.type.startsWith('text/')||file.type==='application/json')extracted=new TextDecoder().decode(bytes).slice(0,50000);
    const uploaded=await db.storage.from('crm-wa-ai-attachments').upload(path,bytes,{contentType:file.type,upsert:false});
    if(uploaded.error)return json({error:'Não foi possível guardar o anexo.'},503);
    const {data:attachment,error}=await db.from('crm_wa_ai_attachments').insert({channel_id:channel.id,file_name:safeName,mime_type:file.type,size_bytes:file.size,storage_path:path,extracted_text:extracted,created_by:auth.user.id}).select('id,file_name,mime_type,size_bytes,created_at').single();
    if(error){await db.storage.from('crm-wa-ai-attachments').remove([path]);return json({error:'Não foi possível registrar o anexo.'},503);}
    return json({ok:true,attachment});
  }
  if(action!=='test'&&action!=='suggest')return json({error:'Ação inválida.'},400);
  const conversationId=action==='suggest'?uuid(input.conversationId):'';
  if(action==='suggest'){
    if(!conversationId)return json({error:'Conversa inválida.'},400);
    const {data:conversation}=await db.from('crm_wa_conversations').select('id,channel_id').eq('id',conversationId).eq('channel_id',channel.id).maybeSingle();
    if(!conversation)return json({error:'Conversa não encontrada.'},404);
    const {data:grant}=await db.from('crm_wa_access').select('id').eq('user_id',auth.user.id).eq('conversation_id',conversationId).maybeSingle();
    if(!admin&&!grant)return json({error:'Conversa não encontrada.'},404);
  }else if(!admin)return json({error:'Teste restrito ao administrador.'},403);
  const {data:settings,error:settingsError}=await db.from('crm_wa_ai_settings').select('provider,model,mode,system_prompt,training_prompt,training_config,api_secret_id').eq('channel_id',channel.id).maybeSingle();
  if(settingsError||!settings?.api_secret_id)return json({error:'Configure e salve uma chave de API primeiro.'},409);
  const {data:apiKey,error:keyError}=await db.rpc('crm_wa_ai_get_secret',{p_channel_id:channel.id});
  if(keyError||typeof apiKey!=='string')return json({error:'A chave de API não está disponível.'},503);
  let messages:AiMessage[]=[{role:'user',content:'Responda apenas: conexão confirmada.'}];
  if(action==='suggest'){
    const {data:rows,error}=await db.from('crm_wa_messages').select('direction,body,kind').eq('conversation_id',conversationId).is('reaction_to_provider_message_id',null).order('occurred_at',{ascending:false}).limit(20);
    if(error)return json({error:'Não foi possível carregar o histórico.'},503);
    messages=(rows??[]).reverse().filter(row=>row.kind==='text'&&String(row.body??'').trim()).map(row=>({role:row.direction==='inbound'?'user':'assistant',content:String(row.body).slice(0,2000)} as AiMessage));
    if(!messages.length)return json({error:'Ainda não há texto suficiente para sugerir uma resposta.'},409);
  }
  try{
    const reply=await requestAiReply({provider:settings.provider as AiProvider,apiKey,model:settings.model,systemPrompt:`${settings.system_prompt}\n\nTREINAMENTO GERAL DO SDR\n${settings.training_prompt}\n\n${trainedPrompt('',settings.training_config as Record<string,string>)}`,messages});
    return json({ok:true,reply:reply.text});
  }catch(error){console.error('whatsapp ai provider failed',{code:error instanceof Error?error.message:'unknown'});return json({error:'O provedor de IA recusou a solicitação. Confira a chave e o modelo.'},502);}
});
