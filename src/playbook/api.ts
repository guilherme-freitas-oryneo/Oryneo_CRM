import { supabase } from '../data';
import { CONTENT_VERSION } from './content';

export type MarkColor = 'yellow' | 'blue' | 'mint';
export type MarkVisibility = 'private' | 'team';
export type PlaybookAnnotation = {
  id: string;
  user_id: string;
  slide_id: string;
  block_key: string;
  start_offset: number;
  end_offset: number;
  quote: string;
  note: string;
  color: MarkColor;
  visibility: MarkVisibility;
  content_version: string;
  created_at: string;
  updated_at: string;
};
export type PlaybookSelection = Pick<PlaybookAnnotation,'slide_id'|'block_key'|'start_offset'|'end_offset'|'quote'>;

export const blockMatches = (text: string, mark: PlaybookAnnotation) =>
  mark.content_version === CONTENT_VERSION &&
  mark.start_offset >= 0 &&
  mark.end_offset > mark.start_offset &&
  mark.end_offset <= text.length &&
  text.slice(mark.start_offset,mark.end_offset) === mark.quote;

export function splitHighlights(text: string, marks: PlaybookAnnotation[]) {
  const matching = marks.filter(mark => blockMatches(text,mark));
  const limits = [...new Set([0,text.length,...matching.flatMap(mark => [mark.start_offset,mark.end_offset])])].sort((a,b) => a-b);
  return limits.slice(0,-1).map((start,index)=>{
    const end = limits[index+1];
    const active = matching.filter(mark=>mark.start_offset <= start && mark.end_offset >= end);
    return {text:text.slice(start,end),mark:active[active.length-1] ?? null};
  }).filter(piece=>piece.text.length);
}

export async function loadPlaybookState(){
  const {data:auth,error:authError} = await supabase.auth.getUser();
  if(authError || !auth.user) throw new Error('É necessário entrar novamente no CRM.');
  const [{data:annotations,error:annotationsError},{data:progress,error:progressError}] = await Promise.all([
    supabase.from('crm_playbook_annotations').select('*').order('created_at',{ascending:true}),
    supabase.from('crm_playbook_progress').select('last_slide_id').eq('user_id',auth.user.id).maybeSingle()
  ]);
  if(annotationsError || progressError) throw new Error('Biblioteca ainda não foi habilitada no banco de dados. A migração deve ser homologada antes da publicação.');
  return {userId:auth.user.id,annotations:(annotations||[]) as PlaybookAnnotation[],lastSlide:progress?.last_slide_id as string|undefined};
}
export async function saveAnnotation(userId:string,selection:PlaybookSelection,note:string,visibility:MarkVisibility,color:MarkColor){
  const {data,error} = await supabase.from('crm_playbook_annotations').insert({
    user_id:userId,...selection,note:note.slice(0,4000),visibility,color,content_version:CONTENT_VERSION
  }).select('*').single();
  if(error) throw new Error('Não foi possível salvar a anotação.');
  return data as PlaybookAnnotation;
}
export async function editAnnotation(id:string,userId:string,note:string,visibility:MarkVisibility){
  const {data,error}=await supabase.from('crm_playbook_annotations').update({
    note:note.slice(0,4000),visibility,updated_at:new Date().toISOString()
  }).eq('id',id).eq('user_id',userId).select('*').single();
  if(error)throw new Error('Não foi possível atualizar a anotação.');
  return data as PlaybookAnnotation;
}
export async function removeAnnotation(id:string,userId:string){
  const {error}=await supabase.from('crm_playbook_annotations').delete().eq('id',id).eq('user_id',userId);
  if(error)throw new Error('Não foi possível excluir a marcação.');
}
export async function saveProgress(userId:string,slideId:string){
  const {error}=await supabase.from('crm_playbook_progress').upsert({
    user_id:userId,last_slide_id:slideId,updated_at:new Date().toISOString()
  },{onConflict:'user_id'});
  if(error)throw new Error('Não foi possível atualizar o progresso de leitura.');
}
