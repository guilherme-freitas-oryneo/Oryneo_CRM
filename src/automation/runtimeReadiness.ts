import type {NodeKind} from './flowDefinition';

/**
 * UI capability disclosure, NOT a runtime permission check.
 * Source of truth remains server graphGuard, published version and
 * the Supabase channel cutover/release RPCs.
 */
export type RuntimeCapability='structural'|'shadow_only'|'durable_control'|
 'controlled_crm'|'controlled_channel'|'blocked_live';
export const RUNTIME_CAPABILITIES:Readonly<Record<NodeKind,RuntimeCapability>>={
 trigger:'structural',condition:'structural',end:'structural',stop:'structural',
 intent_classifier:'shadow_only',knowledge_lookup:'shadow_only',
 billing_read:'shadow_only',wait:'durable_control',
 crm_task:'controlled_crm',crm_stage_change:'controlled_crm',
 ai_generate:'blocked_live',whatsapp_template:'controlled_channel',
 whatsapp_reply:'controlled_channel',email:'controlled_channel',crm_update:'blocked_live',
 human_handoff:'blocked_live',notify:'blocked_live',
};
export function explainRuntimeCapability(kind:NodeKind):string {
 const capability=RUNTIME_CAPABILITIES[kind];
 if(capability==='structural')return 'Controle de fluxo: somente a versão publicada e homologada pode executar.';
 if(capability==='controlled_crm')return 'Adaptador CRM preparatório: operação real exige versão publicada, ownership e gates; nenhum efeito no editor.';
 if(capability==='controlled_channel')return 'Adaptador de canal dormente: só executa com conteúdo aprovado, consentimento atual, ownership exclusivo e todos os gates de release.';
 if(capability==='durable_control')return 'Espera persistente preparada: retomada exige lease válido, grafo publicado e nova verificação de resposta, consentimento e release.';
 if(capability==='shadow_only')return 'Planejamento/simulação: execução produtiva deste nó ainda não homologada.';
 return 'Ação indisponível para execução produtiva pela nova engine. Somente rascunho e simulação.';
}
