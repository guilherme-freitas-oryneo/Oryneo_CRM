import {CONTENT_VERSION} from '../../src/playbook/content';
import type {PlaybookAnnotation,PlaybookSelection,MarkColor,MarkVisibility} from '../../src/playbook/api';
export type {PlaybookAnnotation,PlaybookSelection,MarkColor,MarkVisibility} from '../../src/playbook/api';
const userId='22222222-2222-4222-8222-222222222222';
let saved:PlaybookAnnotation[]=[];
let resumed='02';
export function blockMatches(text:string,m:PlaybookAnnotation){return m.content_version===CONTENT_VERSION&&m.start_offset>=0&&m.end_offset>m.start_offset&&m.end_offset<=text.length&&text.slice(m.start_offset,m.end_offset)===m.quote}
export function splitHighlights(text:string,marks:PlaybookAnnotation[]){
 const matching=marks.filter(mark=>blockMatches(text,mark));
 const limits=[...new Set([0,text.length,...matching.flatMap(mark=>[mark.start_offset,mark.end_offset])])].sort((a,b)=>a-b);
 return limits.slice(0,-1).map((start,index)=>{const end=limits[index+1];const active=matching.filter(mark=>mark.start_offset<=start&&mark.end_offset>=end);return{text:text.slice(start,end),mark:active[active.length-1]??null}}).filter(piece=>piece.text.length);
}
export async function loadPlaybookState(){return{userId,annotations:[...saved],lastSlide:resumed}}
export async function saveAnnotation(uid:string,selection:PlaybookSelection,note:string,visibility:MarkVisibility,color:MarkColor){
 if(uid!==userId)throw Error('not authenticated');const date=new Date().toISOString();
 const mark:PlaybookAnnotation={...selection,id:crypto.randomUUID(),user_id:uid,content_version:CONTENT_VERSION,created_at:date,updated_at:date,note,visibility,color};saved.push(mark);return mark;
}
export async function editAnnotation(id:string,uid:string,note:string,visibility:MarkVisibility){const mark=saved.find(m=>m.id===id&&m.user_id===uid);if(!mark)throw Error('Unauthorized');mark.note=note;mark.visibility=visibility;mark.updated_at=new Date().toISOString();return{...mark}}
export async function removeAnnotation(id:string,uid:string){saved=saved.filter(m=>m.id!==id||m.user_id!==uid)}
export async function saveProgress(uid:string,slideId:string){if(uid!==userId)throw Error('Unauthorized');resumed=slideId}
