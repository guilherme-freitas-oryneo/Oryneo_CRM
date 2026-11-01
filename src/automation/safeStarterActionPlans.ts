/**
 * Optional safe CRM review variants for the eight ORYNEO starting journeys.
 *
 * These are NOT automatically installed, published or enabled. They never
 * dispatch external messages. The existing zero-action starters are unchanged.
 * A publisher must still review the immutable canonical event, content and
 * action policy before any activation.
 */
import {buildStarterFlow,type StarterFlowId} from './starterFlows.ts';
import type {FlowDefinition,FlowNode,FlowEdge} from './flowDefinition.ts';

type SafeTask = {title:string;dueOffsetMinutes:number};
const REVIEW_TASKS: Readonly<Record<StarterFlowId,SafeTask>> = {
  new_opportunity: {title:'Revisar nova oportunidade',dueOffsetMinutes:60},
  talk_to_us: {title:'Revisar solicitação de conversa',dueOffsetMinutes:60},
  direct_checkout: {title:'Revisar checkout iniciado sem presumir pagamento',dueOffsetMinutes:120},
  payment_confirmed: {title:'Conferir início do onboarding após pagamento verificado',dueOffsetMinutes:60},
  diagnosis: {title:'Revisar diagnóstico e próximo passo',dueOffsetMinutes:1440},
  proposal: {title:'Conferir proposta enviada e próxima ação',dueOffsetMinutes:1440},
  follow_up: {title:'Revalidar elegibilidade antes de eventual follow-up',dueOffsetMinutes:15},
  conversational_sdr: {title:'Revisar contexto da conversa e necessidade de handoff',dueOffsetMinutes:60},
};

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function buildCrmReviewStarter(
  starterId:StarterFlowId,
  newId:()=>string=()=>crypto.randomUUID(),
):FlowDefinition {
  const graph=buildStarterFlow(starterId,newId);
  const task=REVIEW_TASKS[starterId];
  if(!task)throw Error('UNKNOWN_STARTER_FLOW');
  const existing=new Set([graph.id,...graph.nodes.map(n=>n.id),...graph.edges.map(e=>e.id)]);
  const unique=()=>{
    const id=newId();
    if(!UUID.test(id)||existing.has(id))throw Error('INVALID_REVIEW_STARTER_ID');
    existing.add(id);return id;
  };
  const end=graph.nodes.find(n=>n.type==='end');
  if(!end)throw Error('REVIEW_STARTER_END_MISSING');
  const incoming=graph.edges.filter(e=>e.target===end.id);
  if(incoming.length!==1)throw Error('REVIEW_STARTER_ROUTE_AMBIGUOUS');
  const upstream=incoming[0];
  const taskNode:FlowNode={
    id:unique(),type:'crm_task',label:'Tarefa interna de revisão',
    position:{x:990,y:100},ports:['in','out'],
    config:{title:task.title,due_offset_minutes:task.dueOffsetMinutes},
  };
  const terminalEdge:FlowEdge={
    id:unique(),source:taskNode.id,source_port:'out',
    target:end.id,target_port:'in',
  };
  return {
    ...graph,
    nodes:[...graph.nodes.map(node=>
      node.id===end.id?{...node,position:{...node.position,x:1290}}:node
    ),taskNode],
    edges:[...graph.edges.map(edge=>
      edge.id===upstream.id?{...edge,target:taskNode.id}:edge
    ),terminalEdge],
    status:'draft',
    description:graph.description+' Variante opcional: cria somente tarefa interna; nao envia mensagem nem altera etapa.',
    metadata:{
      ...graph.metadata,
      draft_variant:'crm_review_only',
      external_transport_allowed:false,
      source_payment_proof_required:starterId==='payment_confirmed',
      live_dispatch:false,
      requires_business_approval:true,
    },
  };
}
