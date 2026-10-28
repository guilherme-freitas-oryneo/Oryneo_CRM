import { createClient } from 'npm:@supabase/supabase-js@2.90.1';
import { requestAiReply, type AiMessage, type AiProvider } from '../_shared/whatsapp/aiProvider.ts';

const url=Deno.env.get('SUPABASE_URL')??'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const db=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f-]{36}$/i.test(value)?value:'';

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return json({error:'Método inválido.'},405);
  const bearer=req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if(!bearer)return json({error:'Autenticação necessária.'},401);
  const {data:auth,error:authError}=await db.auth.getUser(bearer);
  if(authError||!auth.user)return json({error:'Sessão inválida.'},401);
  let input:Record<string,unknown>;
  try{input=await req.json();}catch{return json({error:'Dados inválidos.'},400);}
  const {data:channel}=await db.from('crm_wa_channels').select('id').eq('display_phone_number','+5521974510932').maybeSingle();
  if(!channel)return json({error:'Canal do WhatsApp não encontrado.'},404);
  const {data:admin}=await db.from('crm_wa_access').select('id').eq('user_id',auth.user.id).eq('channel_id',channel.id).is('conversation_id',null).eq('role','admin').maybeSingle();
  const action=input.action;
  if(action==='get'){
    if(!admin)return json({error:'Ajustes restritos ao administrador.'},403);
    const {data,error}=await db.from('crm_wa_ai_settings').select('provider,model,mode,system_prompt,api_key_last_four,updated_at').eq('channel_id',channel.id).maybeSingle();
    return error?json({error:'Não foi possível carregar os ajustes.'},503):json({ok:true,settings:data??{provider:'openai',model:'gpt-5-mini',mode:'off',system_prompt:'',api_key_last_four:null}});
  }
  if(action==='save'){
    if(!admin)return json({error:'Ajustes restritos ao administrador.'},403);
    const provider=input.provider==='anthropic'?'anthropic':input.provider==='openai'?'openai':'';
    const model=typeof input.model==='string'?input.model.trim():'';
    const mode=['off','suggest'].includes(String(input.mode))?String(input.mode):'';
    const systemPrompt=typeof input.systemPrompt==='string'?input.systemPrompt.trim():'';
    const apiKey=typeof input.apiKey==='string'?input.apiKey.trim():'';
    if(!provider||!model||model.length>100||!mode||systemPrompt.length<40||systemPrompt.length>5000)return json({error:'Revise o provedor, o modelo e as instruções.'},400);
    const {data:existing}=await db.from('crm_wa_ai_settings').select('api_secret_id').eq('channel_id',channel.id).maybeSingle();
    if(mode!=='off'&&!apiKey&&!existing?.api_secret_id)return json({error:'Informe uma chave de API antes de ativar a IA.'},400);
    const {error}=await db.from('crm_wa_ai_settings').upsert({channel_id:channel.id,provider,model,mode,system_prompt:systemPrompt,updated_by:auth.user.id,updated_at:new Date().toISOString()});
    if(error)return json({error:'Não foi possível salvar os ajustes.'},503);
    if(apiKey){const stored=await db.rpc('crm_wa_ai_store_secret',{p_channel_id:channel.id,p_secret:apiKey});if(stored.error)return json({error:'Não foi possível proteger a chave de API.'},503);}
    return json({ok:true});
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
  const {data:settings,error:settingsError}=await db.from('crm_wa_ai_settings').select('provider,model,mode,system_prompt,api_secret_id').eq('channel_id',channel.id).maybeSingle();
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
    const reply=await requestAiReply({provider:settings.provider as AiProvider,apiKey,model:settings.model,systemPrompt:settings.system_prompt,messages});
    return json({ok:true,reply});
  }catch(error){console.error('whatsapp ai provider failed',{code:error instanceof Error?error.message:'unknown'});return json({error:'O provedor de IA recusou a solicitação. Confira a chave e o modelo.'},502);}
});
