import type {NodeKind} from './flowDefinition';

/**
 * UI capability disclosure, NOT a runtime permission check.
 * Source of truth remains server graphGuard, published version and
 * the Supabase channel cutover/release RPCs.
 */
export type RuntimeCapability='structural'|'shadow_only'|'controlled_crm'|'blocked_live';
export const RUNTIME_CAPABILITIES:Readonly<Record<NodeKind,RuntimeCapability>>={
 trigger:'structural',condition:'structural',end:'structural',stop:'structural',
 intent_classifier:'shadow_only',knowledge_lookup:'shadow_only',
 billing_read:'shadow_only',wait:'shadow_only',
 crm_task:'controlled_crm',crm_stage_change:'controlled_crm',
 ai_generate:'blocked_live',whatsapp_template:'blocked_live',
 whatsapp_reply:'blocked_live',email:'blocked_live',crm_update:'blocked_live',
 human_handoff:'blocked_live',notify:'blocked_live',
};
export function explainRuntimeCapability(kind:NodeKind):string {
 const capability=RUNTIME_CAPABILITIES[kind];
 if(capability==='structural')return 'Controle de fluxo: somente a versão publicada e homologada pode executar.';
 if(capability==='controlled_crm')return 'Adaptador CRM preparatório: operação real exige versão publicada, ownership e gates; nenhum efeito no editor.';
 if(capability==='shadow_only')return 'Planejamento/simulação: execução produtiva deste nó ainda não homologada.';
 return 'Ação indisponível para execução produtiva pela nova engine. Somente rascunho e simulação.';
}
