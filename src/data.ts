import { createClient } from '@supabase/supabase-js';
export const supabase = createClient('https://ucikrafwfzamxvweuvgk.supabase.co','sb_publishable_nrZxV0W6d88FuvQKXsTDUg_wtGyRrTi');
export type Stage = { name:string; color:string; position:number; outcome:'open'|'won'|'lost' };
export type Deal = { title:string; company:string; contact:string; email:string; phone:string; value_cents:number; stage_id:string; notes:string; source:string; due_date:string };
export type RecordRow<T=Stage|Deal> = { id:string; kind:'stage'|'deal'; data:T; revision:number; deleted:boolean; created_at:string; updated_at:string };
export type StageRow = RecordRow<Stage>;
export type DealRow = RecordRow<Deal>;
export const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export const normalized=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const matches=(deal:Deal,query:string)=>normalized([deal.title,deal.company,deal.contact,deal.email,deal.phone,deal.notes,deal.source].join(' ')).includes(normalized(query.trim()));
export async function getBoard(){
 const {data:member,error:memberError}=await supabase.from('crm_members').select('user_id').limit(1);
 if(memberError) throw memberError;
 if(!member?.length) throw new Error('Sua conta ainda não tem acesso a este CRM. Entre em contato com o administrador.');
 const rows:RecordRow[]=[];
 for(let start=0;;start+=1000){const {data,error}=await supabase.from('crm_records').select('*').eq('deleted',false).order('id').range(start,start+999);if(error)throw error;rows.push(...data);if(data.length<1000)break;}
 return rows;
}
export async function mutate(row:{id:string;kind:'stage'|'deal';data:Stage|Deal;revision:number},deleted=false){
 const {data,error}=await supabase.rpc('crm_mutate',{p_id:row.id,p_kind:row.kind,p_data:row.data,p_revision:row.revision,p_deleted:deleted});if(error)throw error;return data as string;
}
export async function undo(operation:string){const {error}=await supabase.rpc('crm_undo',{p_operation:operation});if(error)throw error;}
export const errorText=(e:unknown)=>e instanceof Error?e.message:(e as {message?:string})?.message||'Não foi possível concluir. Tente novamente.';
