export type AiProvider = 'openai'|'anthropic';
export type AiMessage = { role:'user'|'assistant'; content:string };
export type AiRequest = { provider:AiProvider; apiKey:string; model:string; systemPrompt:string; messages:AiMessage[] };

type Fetcher = (input:string|URL|Request,init?:RequestInit)=>Promise<Response>;

const clean=(value:unknown)=>typeof value==='string'?value.trim().slice(0,4096):'';

export async function requestAiReply(input:AiRequest,fetcher:Fetcher=fetch):Promise<string>{
  if(!input.apiKey||!input.model||!input.systemPrompt||!input.messages.length)throw new Error('AI_CONFIGURATION_INVALID');
  const endpoint=input.provider==='openai'?'https://api.openai.com/v1/responses':'https://api.anthropic.com/v1/messages';
  const headers:Record<string,string>={'Content-Type':'application/json'};
  const body=input.provider==='openai'
    ? {model:input.model,instructions:input.systemPrompt,input:input.messages,max_output_tokens:500}
    : {model:input.model,system:input.systemPrompt,messages:input.messages,max_tokens:500};
  if(input.provider==='openai')headers.Authorization=`Bearer ${input.apiKey}`;
  else{headers['x-api-key']=input.apiKey;headers['anthropic-version']='2023-06-01';}
  const response=await fetcher(endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  const payload=await response.json().catch(()=>null) as Record<string,unknown>|null;
  if(!response.ok||!payload)throw new Error(`AI_PROVIDER_${response.status}`);
  if(input.provider==='openai'){
    const direct=clean(payload.output_text);
    if(direct)return direct;
    const output=Array.isArray(payload.output)?payload.output:[];
    for(const item of output){
      const content=typeof item==='object'&&item&&Array.isArray((item as {content?:unknown}).content)?(item as {content:unknown[]}).content:[];
      for(const block of content){const text=clean(typeof block==='object'&&block?(block as {text?:unknown}).text:'');if(text)return text;}
    }
  }else{
    const content=Array.isArray(payload.content)?payload.content:[];
    for(const block of content){if(typeof block==='object'&&block&&(block as {type?:unknown}).type==='text'){const text=clean((block as {text?:unknown}).text);if(text)return text;}}
  }
  throw new Error('AI_EMPTY_RESPONSE');
}
