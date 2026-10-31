/** Pure editor operations; never invoke providers or persist remote changes. */
import {validateFlow,type FlowDefinition,type FlowNode} from './flowDefinition';
import type {EditResult} from './graphEditing';

const fail=(code:string):EditResult=>({ok:false,code});
export const clampPosition=(n:number)=>Math.max(12,Math.min(16000,Math.round(n)));
/** One history transaction for multi-node move. Edges and configs remain identical. */
export function moveSelectedNodes(graph:FlowDefinition,ids:readonly string[],dx:number,dy:number):EditResult{
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return fail('MOVE_INVALID');
  const select=new Set(ids);
  if(!select.size||graph.nodes.every(n=>!select.has(n.id)))return fail('NO_SELECTION');
  return {ok:true,graph:{...graph,nodes:graph.nodes.map(n=>select.has(n.id)?{
    ...n,position:{x:clampPosition(n.position.x+dx),y:clampPosition(n.position.y+dy)}
  }:n)}};
}
export function removeSelectedNodes(graph:FlowDefinition,ids:readonly string[]):EditResult{
  const select=new Set(ids);
  if(graph.nodes.some(n=>select.has(n.id)&&n.type==='trigger'))return fail('TRIGGER_REQUIRED');
  if(!graph.nodes.some(n=>select.has(n.id)))return fail('NO_SELECTION');
  return {ok:true,graph:{
    ...graph,nodes:graph.nodes.filter(n=>!select.has(n.id)),
    edges:graph.edges.filter(e=>!select.has(e.source)&&!select.has(e.target)),
  }};
}
export function removeEdgeById(graph:FlowDefinition,edgeId:string):EditResult{
  if(!graph.edges.some(e=>e.id===edgeId))return fail('EDGE_UNKNOWN');
  return {ok:true,graph:{...graph,edges:graph.edges.filter(e=>e.id!==edgeId)}};
}
export function duplicateDraftNode(graph:FlowDefinition,nodeId:string,newId:string):EditResult{
  const n=graph.nodes.find(x=>x.id===nodeId);
  if(!n)return fail('NODE_UNKNOWN');
  if(n.type==='trigger')return fail('TRIGGER_REQUIRED_SINGLE');
  if(!newId||graph.nodes.some(x=>x.id===newId)||graph.edges.some(x=>x.id===newId))
    return fail('DUPLICATE_ID');
  if(graph.nodes.length>=500)return fail('FLOW_TOO_LARGE');
  const copy:FlowNode={...n,id:newId,label:n.label+' — cópia',
    position:{x:clampPosition(n.position.x+45),y:clampPosition(n.position.y+75)},
    config:JSON.parse(JSON.stringify(n.config)),ports:[...n.ports]};
  return {ok:true,graph:{...graph,nodes:[...graph.nodes,copy]}};
}
const badKey=(x:unknown,level=0):boolean=>{
  if(level>25)return true;
  if(Array.isArray(x))return x.some(v=>badKey(v,level+1));
  if(x&&typeof x==='object')return Object.entries(x).some(([k,v])=>
    ['__proto__','prototype','constructor'].includes(k)||badKey(v,level+1));
  return false;
};
/**
 * Imported flows are cloned under fresh graph/node/edge identities.
 * No imported document can overwrite a canonical flow or mark itself published.
 */
export function importDraftJson(raw:string,expectedKind:'pipeline'|'sdr'):EditResult{
  if(raw.length>250_000)return fail('IMPORT_TOO_LARGE');
  let input:unknown;
  try{input=JSON.parse(raw);}catch{return fail('IMPORT_JSON_INVALID');}
  if(!input||typeof input!=='object'||badKey(input))return fail('IMPORT_UNSAFE');
  const validation=validateFlow(input);
  if(!validation.ok)return fail('IMPORT_GRAPH_INVALID:'+validation.issues.slice(0,3).map(x=>x.code).join(','));
  const graph=input as FlowDefinition;
  if(graph.kind!==expectedKind)return fail('IMPORT_KIND_MISMATCH');
  const nodes=new Map(graph.nodes.map(node=>[node.id,crypto.randomUUID()]));
  return {ok:true,graph:{
    schema_version:graph.schema_version,
    id:crypto.randomUUID(),name:graph.name.slice(0,120)+' — importado',
    version:1,kind:graph.kind,status:'draft',
    nodes:graph.nodes.map(n=>({...n,id:nodes.get(n.id)!,position:{...n.position},
      config:JSON.parse(JSON.stringify(n.config)),ports:[...n.ports]})),
    edges:graph.edges.map(e=>({...e,id:crypto.randomUUID(),
      source:nodes.get(e.source)!,target:nodes.get(e.target)!})),
    description:graph.description,
  }};
}
export type CanvasPoint={x:number;y:number};
export function viewportToGraph(client:CanvasPoint,rect:{left:number;top:number},
 scroll:{left:number;top:number},zoom:number):CanvasPoint{
  if(!Number.isFinite(zoom)||zoom<=0)throw Error('ZOOM_INVALID');
  return {x:(client.x-rect.left+scroll.left)/zoom,
          y:(client.y-rect.top+scroll.top)/zoom};
}
export function fitGraphView(nodes:readonly Pick<FlowNode,'position'>[],
 viewport:{width:number;height:number},padding=64):{zoom:number;left:number;top:number}{
  if(!nodes.length||viewport.width<=0||viewport.height<=0)return {zoom:1,left:0,top:0};
  const left=Math.min(...nodes.map(n=>n.position.x));
  const top=Math.min(...nodes.map(n=>n.position.y));
  const right=Math.max(...nodes.map(n=>n.position.x+240));
  const bottom=Math.max(...nodes.map(n=>n.position.y+142));
  const zoom=Math.min(1.5,Math.max(0.4,Math.min(
    (viewport.width-2*padding)/(right-left),(viewport.height-2*padding)/(bottom-top)
  )));
  return {zoom:+zoom.toFixed(3),
    left:Math.max(0,left*zoom-(viewport.width-(right-left)*zoom)/2),
    top:Math.max(0,top*zoom-(viewport.height-(bottom-top)*zoom)/2)};
}
export function routeBranchLabel(port:string):string{
  return ({yes:'Sim',no:'Não',out:'Continuar',error:'Erro',timeout:'Tempo esgotado',
    uncertain:'Revisão',found:'Encontrado',missing:'Não encontrado'} as Record<string,string>)[port]||port;
}
