import { supabase } from '../data';

export type AiTraining={business_context:string;tone:string;objective:string;qualification_questions:string;guardrails:string;handoff_rule:string};
export type AiSettings={provider:'openai'|'anthropic';model:string;mode:'off'|'suggest'|'auto';system_prompt:string;training_config:AiTraining;api_key_last_four:string|null};

const invoke=async(body:Record<string,unknown>)=>{
 const {data,error}=await supabase.functions.invoke('whatsapp-ai-settings',{body});
 if(error){const response=(error as {context?:unknown}).context;if(response instanceof Response){const detail=await response.clone().json().catch(()=>null);if(detail?.error)throw new Error(detail.error);}throw new Error('Não foi possível acessar os ajustes de IA.');}
 if(data?.error)throw new Error(data.error);
 return data;
};
export async function loadAiSettings():Promise<AiSettings>{const data=await invoke({action:'get'});return data.settings as AiSettings;}
export async function saveAiSettings(input:{provider:'openai'|'anthropic';model:string;mode:'off'|'suggest'|'auto';systemPrompt:string;trainingConfig:AiTraining;apiKey:string}):Promise<void>{await invoke({action:'save',...input});}
export async function testAiSettings():Promise<string>{const data=await invoke({action:'test'});return String(data.reply??'Conexão confirmada.');}
