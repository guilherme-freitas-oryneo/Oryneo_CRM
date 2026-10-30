/**
 * Candidate node registry for the ORYNEO editor; labels and port semantics only.
 * This is NOT a server-side permission list, a published runtime or send authorization.
 */
import type { FlowKind, NodeKind } from './flowDefinition';
export type NodeFamily = 'trigger' | 'logic' | 'intelligence' | 'communication' | 'crm' | 'control';
export type NodeDescriptor = {
  title: string;
  family: NodeFamily;
  kinds: readonly FlowKind[];
  input: boolean;
  outputs: readonly string[];
  externalEffect: boolean;
};
const both: readonly FlowKind[] = ['pipeline', 'sdr'];
export const NODE_REGISTRY: Readonly<Record<NodeKind, NodeDescriptor>> = {
  trigger: { title: 'Gatilho de evento', family: 'trigger', kinds: both, input: false, outputs: ['out'], externalEffect: false },
  condition: { title: 'Condição', family: 'logic', kinds: both, input: true, outputs: ['yes', 'no'], externalEffect: false },
  intent_classifier: { title: 'Classificação de intenção', family: 'intelligence', kinds: ['sdr'], input: true, outputs: ['out', 'uncertain'], externalEffect: false },
  knowledge_lookup: { title: 'Conhecimento aprovado', family: 'intelligence', kinds: both, input: true, outputs: ['found', 'missing'], externalEffect: false },
  ai_generate: { title: 'Gerar resposta com IA', family: 'intelligence', kinds: ['sdr'], input: true, outputs: ['out', 'error'], externalEffect: false },
  whatsapp_template: { title: 'Template de WhatsApp', family: 'communication', kinds: both, input: true, outputs: ['out', 'error'], externalEffect: true },
  whatsapp_reply: { title: 'Resposta pelo WhatsApp', family: 'communication', kinds: ['sdr'], input: true, outputs: ['out', 'error'], externalEffect: true },
  email: { title: 'E-mail', family: 'communication', kinds: both, input: true, outputs: ['out', 'error'], externalEffect: true },
  crm_stage_change: { title: 'Mover etapa comercial', family: 'crm', kinds: ['pipeline'], input: true, outputs: ['out'], externalEffect: true },
  crm_task: { title: 'Criar tarefa', family: 'crm', kinds: both, input: true, outputs: ['out'], externalEffect: true },
  crm_update: { title: 'Atualizar oportunidade', family: 'crm', kinds: ['pipeline'], input: true, outputs: ['out'], externalEffect: true },
  billing_read: { title: 'Consultar pedido canônico', family: 'crm', kinds: ['pipeline'], input: true, outputs: ['out'], externalEffect: false },
  wait: { title: 'Esperar evento ou prazo', family: 'control', kinds: both, input: true, outputs: ['out', 'timeout'], externalEffect: false },
  human_handoff: { title: 'Transferir para humano', family: 'control', kinds: both, input: true, outputs: ['out'], externalEffect: true },
  notify: { title: 'Notificação interna', family: 'communication', kinds: both, input: true, outputs: ['out'], externalEffect: true },
  stop: { title: 'Interromper fluxo', family: 'control', kinds: both, input: true, outputs: [], externalEffect: false },
  end: { title: 'Concluir fluxo', family: 'control', kinds: both, input: true, outputs: [], externalEffect: false },
};
export const NODE_KINDS: readonly NodeKind[] = Object.keys(NODE_REGISTRY) as NodeKind[];
export function nodePalette(kind: FlowKind): { type: NodeKind; descriptor: NodeDescriptor }[] {
  return NODE_KINDS.filter(type => NODE_REGISTRY[type].kinds.includes(kind))
    .map(type => ({ type, descriptor: NODE_REGISTRY[type] }));
}
/** Validate port direction for a future canvas before a draft edge is created. */
export function validRegistryConnection(sourceType: NodeKind, sourcePort: string, targetType: NodeKind, targetPort: string): boolean {
  const source = NODE_REGISTRY[sourceType];
  const target = NODE_REGISTRY[targetType];
  if (!source || !target || !target.input || targetPort !== 'in') return false;
  // Condition cases may introduce branch outputs, but only when the condition's typed config declares them.
  return source.outputs.includes(sourcePort);
}
