import type { FlowDefinition, FlowKind, FlowNode, FlowEdge } from './flowDefinition.ts';

/**
 * Eight UX starting points from the approved ZIP. These are editable DRAFTS,
 * NOT published business rules or live channel sequences.
 *
 * Every preset is deliberately non-emitting. The publisher must still add
 * canonical references, action policy, signed-payment proof and channel
 * consent before a real external action can be considered.
 */
export type StarterFlowId =
  | 'new_opportunity' | 'talk_to_us' | 'direct_checkout' | 'payment_confirmed'
  | 'diagnosis' | 'proposal' | 'follow_up' | 'conversational_sdr';

type StarterDescriptor = {
  id: StarterFlowId;
  name: string;
  kind: FlowKind;
  event: string;
  rule: {kind:'exists';field:string} |
        {kind:'compare';field:string;op:'eq';value:string|boolean};
  waitMinutes?: number;
  note: string;
};

export const STARTER_FLOWS: readonly StarterDescriptor[] = [
  {id:'new_opportunity',name:'Nova oportunidade',kind:'pipeline',
   event:'opportunity.created',rule:{kind:'exists',field:'opportunity.stage_id'},
   note:'Recebe uma oportunidade canônica. Adicione tarefas e comunicações após homologar as condições.'},
  {id:'talk_to_us',name:'Quero conversar',kind:'sdr',
   event:'conversation.inbound',rule:{kind:'compare',field:'conversation.mode',op:'eq',value:'sdr_active'},
   note:'Verifica se a conversa permanece sob controle do SDR. Não envia resposta por si só.'},
  {id:'direct_checkout',name:'Checkout direto',kind:'pipeline',
   event:'checkout.started',rule:{kind:'exists',field:'billing.status'},
   note:'Pedido iniciado não significa pagamento confirmado. Requer contexto financeiro canônico.'},
  {id:'payment_confirmed',name:'Pagamento confirmado',kind:'pipeline',
   event:'billing.paid_verified',rule:{kind:'compare',field:'billing.paid_verified',op:'eq',value:true},
   note:'Exige prova de webhook autenticado. Não presume quitação por status textual.'},
  {id:'diagnosis',name:'Diagnóstico',kind:'pipeline',
   event:'opportunity.stage_changed',rule:{kind:'exists',field:'opportunity.stage_id'},
   note:'Etapa comercial identificada. O onboarding existente é preservado.'},
  {id:'proposal',name:'Proposta',kind:'pipeline',
   event:'proposal.sent',rule:{kind:'exists',field:'opportunity.stage_id'},
   note:'Conferência de oportunidade antes de qualquer follow-up comercial.'},
  {id:'follow_up',name:'Follow-up',kind:'sdr',
   event:'conversation.inbound',rule:{kind:'compare',field:'conversation.consent_granted',op:'eq',value:true},
   waitMinutes:60,
   note:'Espera cancelável por resposta do lead. Não dispara template sem consentimento e checagem atual.'},
  {id:'conversational_sdr',name:'SDR conversacional',kind:'sdr',
   event:'conversation.inbound',rule:{kind:'compare',field:'conversation.mode',op:'eq',value:'sdr_active'},
   note:'Trilha segura para classificação, conhecimento aprovado e transferência humana.'},
] as const;

export function buildStarterFlow(
  starterId: StarterFlowId,
  newId: () => string = () => crypto.randomUUID(),
): FlowDefinition {
  const item = STARTER_FLOWS.find(x=>x.id===starterId);
  if(!item)throw new Error('UNKNOWN_STARTER_FLOW');
  const ids=new Set<string>();
  const unique=()=>{
    const id=newId();
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      ||ids.has(id))throw new Error('INVALID_STARTER_ID');
    ids.add(id);return id;
  };
  const flowId=unique();
  const nodes:FlowNode[]=[];
  const edges:FlowEdge[]=[];
  const add=(type:FlowNode['type'],label:string,config:FlowNode['config'],
    ports:string[],x:number,y:number):FlowNode=>{
    const node:FlowNode={id:unique(),type,label,config,ports,position:{x,y}};
    nodes.push(node);return node;
  };
  const link=(source:FlowNode,port:string,target:FlowNode)=>{
    edges.push({id:unique(),source:source.id,source_port:port,target:target.id,target_port:'in'});
  };
  const trigger=add('trigger','Evento canônico',{event_type:item.event},['out'],80,200);
  const gate=add('condition','Condição verificada',{rule:item.rule},['in','yes','no'],390,200);
  const stop=add('stop','Interromper sem ação',{},['in'],1070,370);
  const end=add('end','Finalizar sem enviar',{},['in'],1070,100);
  link(trigger,'out',gate);
  link(gate,'no',stop);
  if(item.waitMinutes){
    const wait=add('wait','Esperar ou cancelar pela resposta',
      {duration_minutes:item.waitMinutes,cancel_on_reply:true},
      ['in','out','timeout'],720,100);
    link(gate,'yes',wait);
    link(wait,'out',end);
    link(wait,'timeout',stop);
  }else{
    link(gate,'yes',end);
  }
  return {
    schema_version:'1.0.0',id:flowId,name:item.name,
    kind:item.kind,status:'draft',version:1,nodes,edges,
    description:item.note,
    metadata:{starter_id:item.id,requires_business_approval:true,
      live_dispatch:false,source:'ORYNEO_CODEX_AUTOMACOES_SDR_PIPELINE_2026-10-28'},
  };
}
