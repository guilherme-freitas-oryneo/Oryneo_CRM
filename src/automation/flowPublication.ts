/**
 * Publication preflight for ORYNEO drafts.
 * Pure and non-authoritative: the backend MUST repeat validation and enforce
 * permissions, consent, Stripe state, and Meta status at execution time.
 */
import { validateFlow, type FlowDefinition, type FlowIssue, type FlowNode } from './flowDefinition';
import { validateRule } from './conditionRules';
import { NODE_REGISTRY } from './nodeRegistry';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ALLOWED_EVENTS = new Set([
  'opportunity.created', 'opportunity.updated', 'opportunity.stage_changed',
  'lead.intake_received', 'checkout.started', 'checkout.expired',
  'billing.paid_verified', 'billing.failed', 'conversation.inbound',
  'conversation.human_takeover', 'meeting.scheduled', 'proposal.sent',
]);
export type PublicationRefs = {
  approvedTemplateIds: readonly string[];
  publishedKnowledgeIds: readonly string[];
  allowedStageIds: readonly string[];
  enabledIntentDictionaryIds: readonly string[];
  approvedEmailTemplateIds: readonly string[];
  approvedPromptRefs: readonly string[];
  approvedReplyRefs: readonly string[];
};
export type PublicationCheck = { ok: boolean; issues: FlowIssue[] };
const record = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);
const nonblank = (x: unknown, max = 256): x is string =>
  typeof x === 'string' && !!x.trim() && x.length <= max;
const keysAre = (x: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(x).every(key => keys.includes(key));
const validUuid = (x: unknown) => typeof x === 'string' && UUID.test(x);
function validateNodeConfig(
  node: FlowNode,
  refs: PublicationRefs,
  problem: (code: string, message: string) => void,
): void {
  const cfg = node.config;
  const requires = (key: string, type: 'text' | 'uuid' = 'text') => {
    if (type === 'uuid' ? !validUuid(cfg[key]) : !nonblank(cfg[key])) {
      problem('CONFIG_REQUIRED', 'Parâmetro obrigatório inválido: ' + key);
      return false;
    }
    return true;
  };
  switch (node.type) {
    case 'trigger':
      if (!keysAre(cfg, ['event_type']) || !ALLOWED_EVENTS.has(String(cfg.event_type))) {
        problem('TRIGGER_UNSUPPORTED', 'Evento não cadastrado pelo backend.');
      }
      return;
    case 'condition':
      if (!keysAre(cfg, ['rule']) || !validateRule(cfg.rule).ok) {
        problem('CONDITION_UNPUBLISHABLE', 'Condição precisa de uma regra tipada válida.');
      }
      return;
    case 'intent_classifier':
      if (!keysAre(cfg, ['dictionary_release_id', 'min_confidence'])
        || !requires('dictionary_release_id', 'uuid')
        || !refs.enabledIntentDictionaryIds.includes(String(cfg.dictionary_release_id))
        || typeof cfg.min_confidence !== 'number' || cfg.min_confidence < 0.5 || cfg.min_confidence > 0.99) {
        problem('INTENT_RELEASE_INVALID', 'Dicionário de intenções não publicado ou threshold inválido.');
      }
      return;
    case 'knowledge_lookup':
      if (!keysAre(cfg, ['knowledge_release_id', 'question_field'])
        || !requires('knowledge_release_id', 'uuid')
        || !refs.publishedKnowledgeIds.includes(String(cfg.knowledge_release_id))
        || !nonblank(cfg.question_field, 128)) {
        problem('KNOWLEDGE_RELEASE_INVALID', 'Fonte de conhecimento não homologada.');
      }
      return;
    case 'ai_generate':
      if (!keysAre(cfg, ['prompt_ref', 'max_tokens'])
        || !requires('prompt_ref') || !refs.approvedPromptRefs.includes(String(cfg.prompt_ref))
        || !Number.isInteger(cfg.max_tokens) || Number(cfg.max_tokens) < 64 || Number(cfg.max_tokens) > 1200) {
        problem('AI_CONFIG_INVALID', 'Prompt aprovado e limite de custo são obrigatórios.');
      }
      return;
    case 'whatsapp_template':
      if (!keysAre(cfg, ['template_registry_id', 'locale'])
        || !requires('template_registry_id', 'uuid')
        || !refs.approvedTemplateIds.includes(String(cfg.template_registry_id))
        || cfg.locale !== 'pt_BR') {
        problem('TEMPLATE_NOT_APPROVED', 'Template não encontrado como aprovado.');
      }
      return;
    case 'whatsapp_reply':
      if (!keysAre(cfg, ['text_ref']) || !requires('text_ref')
        || !refs.approvedReplyRefs.includes(String(cfg.text_ref))) {
        problem('WA_REPLY_INVALID', 'Resposta sem fonte autorizada.');
      }
      return;
    case 'email':
      if (!keysAre(cfg, ['template_id', 'recipient_field'])
        || !requires('template_id', 'uuid')
        || !refs.approvedEmailTemplateIds.includes(String(cfg.template_id))
        || !['lead.email', 'opportunity.email'].includes(String(cfg.recipient_field))) {
        problem('EMAIL_TEMPLATE_INVALID', 'Template e destinatário exigem cadastro validado.');
      }
      return;
    case 'crm_stage_change':
      if (!keysAre(cfg, ['target_stage_id']) || !requires('target_stage_id', 'uuid')
        || !refs.allowedStageIds.includes(String(cfg.target_stage_id))) {
        problem('STAGE_INVALID', 'Etapa não corresponde ao pipeline canônico.');
      }
      return;
    case 'crm_task':
      if (!keysAre(cfg, ['title', 'due_offset_minutes'])
        || !nonblank(cfg.title, 160)
        || !Number.isSafeInteger(cfg.due_offset_minutes) || Number(cfg.due_offset_minutes) < 0
        || Number(cfg.due_offset_minutes) > 43200) {
        problem('TASK_INVALID', 'Título ou prazo de tarefa inválidos.');
      }
      return;
    case 'crm_update':
      if (!keysAre(cfg, ['allowed_field', 'value_ref'])
        || !['next_action.title', 'due_date', 'notes'].includes(String(cfg.allowed_field))
        || !nonblank(cfg.value_ref, 256)) {
        problem('CRM_UPDATE_INVALID', 'Campo ou origem de atualização não permitido.');
      }
      return;
    case 'billing_read':
      if (Object.keys(cfg).length > 0) problem('BILLING_READ_ONLY', 'Leitura canônica não aceita parâmetros arbitrários.');
      return;
    case 'wait':
      if (!keysAre(cfg, ['duration_minutes', 'cancel_on_reply'])
        || !Number.isInteger(cfg.duration_minutes)
        || Number(cfg.duration_minutes) < 1 || Number(cfg.duration_minutes) > 43200
        || typeof cfg.cancel_on_reply !== 'boolean') {
        problem('WAIT_INVALID', 'Espera exige duração limitada e política de cancelamento.');
      }
      return;
    case 'human_handoff':
      if (!keysAre(cfg, ['reason_code']) || !nonblank(cfg.reason_code, 64)) {
        problem('HANDOFF_INVALID', 'Motivo de transferência é obrigatório.');
      }
      return;
    case 'notify':
      if (!keysAre(cfg, ['event_code']) || !nonblank(cfg.event_code, 64)) {
        problem('NOTIFY_INVALID', 'Código de notificação obrigatório.');
      }
      return;
    case 'stop':
    case 'end':
      if (Object.keys(cfg).length > 0) problem('TERMINAL_CONFIG', 'Nó final não aceita parâmetros.');
      return;
  }
}

export function validatePublication(graph: FlowDefinition, refs: PublicationRefs): PublicationCheck {
  const base = validateFlow(graph);
  if (!base.ok) return { ok: false, issues: base.issues };
  const issues = [...base.issues];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  if (graph.schema_version !== '1.0.0') {
    add('CONCEPT_NOT_PUBLISHABLE', 'schema_version', 'Somente o schema runtime homologado pode ser publicado.');
  }
  if (graph.status !== 'draft') {
    add('NOT_DRAFT', 'status', 'Somente rascunhos podem iniciar publicação.');
  }
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i];
    const path = 'nodes[' + i + ']';
    const def = NODE_REGISTRY[node.type];
    if (!def) { add('NODE_UNKNOWN', path, 'Tipo de nó não reconhecido.'); continue; }
    if (!def.kinds.includes(graph.kind)) {
      add('NODE_KIND_MISMATCH', path, 'Nó não autorizado para esse tipo de fluxo.');
    }
    if (node.disabled) add('DISABLED_NODE', path, 'Não publicar um nó sem política explícita de bypass.');
    const required = [...(def.input ? ['in'] : []), ...def.outputs];
    if (required.length !== node.ports.length
      || required.some(port => !node.ports.includes(port))) {
      add('PORT_SIGNATURE', path + '.ports', 'Portas não correspondem à registry canônica.');
    }
    validateNodeConfig(node, refs, (code, message) => add(code, path + '.config', message));
  }
  return { ok: issues.length === 0, issues };
}

/** Canonical JSON for hashing and frozen immutable published snapshots. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('NON_FINITE_JSON_NUMBER');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(item => item === undefined ? 'null' : canonicalJson(item)).join(',') + ']';
  if (!record(value)) throw new Error('NON_JSON_VALUE');
  return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort()
    .map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}
export async function preparePublication(
  graph: FlowDefinition,
  refs: PublicationRefs,
): Promise<{ ok: true; contentSha256: string; snapshot: FlowDefinition } | { ok: false; issues: FlowIssue[] }> {
  const result = validatePublication(graph, refs);
  if (!result.ok) return result;
  const canonical = canonicalJson({ ...graph, status: 'published' });
  if (new TextEncoder().encode(canonical).length > 256 * 1024) {
    return { ok: false, issues: [{ code: 'SNAPSHOT_TOO_LARGE', path: '
  const bytes = new TextEncoder().encode(canonicalJson(snapshot));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const contentSha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  return { ok: true, contentSha256, snapshot };
}
, message: 'Fluxo acima do limite publicável.' }] };
  }
  const snapshot: FlowDefinition = JSON.parse(canonical);
  const bytes = new TextEncoder().encode(canonicalJson(snapshot));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const contentSha256 = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  return { ok: true, contentSha256, snapshot };
}
