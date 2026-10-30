/**
 * Strict, side-effect-free preflight for workflow publication.
 *
 * NOT an authorization function. The server MUST independently:
 * 1) resolve the authenticated workspace/role, 2) re-read referenced objects,
 * 3) verify provider policy and effective consent, 4) freeze a signed snapshot,
 * 5) own idempotent dispatch. Browser-supplied snapshots are never trusted.
 */
import { validateFlow, type FlowDefinition, type FlowNode } from './flowDefinition';
import { NODE_REGISTRY } from './nodeRegistry';
import { RULE_FIELDS } from './conditionRules';

export const PUBLISHABLE_SCHEMA_VERSION = '1.0.0';
export type PreflightIssue = { code: string; path: string };
export type ReferenceSnapshot = {
  eventTypes: readonly string[];
  stageIds: readonly string[];
  approvedWhatsAppTemplates: readonly string[];
  approvedEmailTemplates: readonly string[];
  knowledgeReleaseIds: readonly string[];
  intentDictionaryIds: readonly string[];
};
export type PublicationPreflight = {
  canSubmitForServerValidation: boolean;
  issues: PreflightIssue[];
  requiresServerAuthorization: true;
};
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const named = (v: unknown, max=160): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const scalar = (v: unknown): boolean =>
  v === null || typeof v === 'string' || typeof v === 'boolean'
    || (typeof v === 'number' && Number.isFinite(v));
const validInteger = (v: unknown, min: number, max: number) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const onlyKeys = (obj: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(obj).every(k => allowed.includes(k));
const inList = (v: unknown, list: readonly string[]) =>
  typeof v === 'string' && list.includes(v);
const validNamedList = (v: unknown, allowed: readonly string[]) =>
  Array.isArray(v) && v.length > 0 && v.length <= 32 && v.every(x => inList(x, allowed));
const safeVariableNames = (v: unknown): boolean =>
  isRecord(v) && Object.keys(v).length <= 20
  && Object.keys(v).every(k => /^[1-9][0-9]?$/.test(k))
  && Object.values(v).every(s => inList(s, RULE_FIELDS));

function declaredOutputs(node: FlowNode): string[] {
  if (node.type === 'condition' && node.config.operator === 'equals_any') {
    return [...(Array.isArray(node.config.cases) ? node.config.cases : []), node.config.default]
      .filter((value): value is string => typeof value === 'string');
  }
  return [...NODE_REGISTRY[node.type].outputs];
}

function nodeConfigIssues(node: FlowNode, refs: ReferenceSnapshot): string[] {
  const c = node.config;
  const problems: string[] = [];
  const requireConfig = (valid: boolean, code: string) => { if (!valid) problems.push(code); };
  switch (node.type) {
    case 'trigger':
      requireConfig(
        onlyKeys(c, ['event_type', 'idempotency'])
          && inList(c.event_type, refs.eventTypes)
          && (c.idempotency === undefined || ['source_event_id', 'provider_message_id'].includes(String(c.idempotency))),
        'TRIGGER_UNVERIFIED',
      );
      break;
    case 'condition':
      if (c.rule !== undefined) {
        // Structural rule shape is checked by validateFlow.
        requireConfig(onlyKeys(c, ['rule']), 'CONDITION_UNSAFE_CONFIG');
      } else if (c.operator === 'equals_any') {
        requireConfig(
          onlyKeys(c, ['field', 'operator', 'cases', 'default'])
            && inList(c.field, RULE_FIELDS) && validNamedList(c.cases, declaredOutputs(node))
            && named(c.default, 128), 'CONDITION_UNSAFE_CONFIG',
        );
      } else {
        requireConfig(
          onlyKeys(c, ['field', 'operator', 'value', 'source'])
            && inList(c.field, RULE_FIELDS) && ['eq', 'neq'].includes(String(c.operator))
            && Object.prototype.hasOwnProperty.call(c, 'value') && scalar(c.value)
            && (c.source === undefined || c.source === 'verified_webhook'),
          'CONDITION_UNSAFE_CONFIG',
        );
      }
      break;
    case 'intent_classifier':
      requireConfig(
        onlyKeys(c, ['dictionary_ref', 'confidence_threshold'])
          && inList(c.dictionary_ref, refs.intentDictionaryIds)
          && typeof c.confidence_threshold === 'number'
          && Number.isFinite(c.confidence_threshold)
          && c.confidence_threshold >= 0.5 && c.confidence_threshold <= 1,
        'INTENT_DICTIONARY_UNVERIFIED',
      );
      break;
    case 'knowledge_lookup':
      requireConfig(
        onlyKeys(c, ['knowledge_release', 'missing_policy'])
          && inList(c.knowledge_release, refs.knowledgeReleaseIds)
          && c.missing_policy === 'human_handoff',
        'KNOWLEDGE_RELEASE_UNVERIFIED',
      );
      break;
    case 'ai_generate': {
      const mandatory = ['no_invented_terms', 'no_payment_claims', 'one_question_at_a_time'];
      const guardrails = c.guardrails;
      requireConfig(
        onlyKeys(c, ['guardrails'])
          && Array.isArray(guardrails)
          && guardrails.length === mandatory.length
          && mandatory.every(rule => guardrails.includes(rule)),
        'AI_GUARDRAILS_REQUIRED',
      );
      break;
    }
    case 'whatsapp_template':
      requireConfig(
        onlyKeys(c, ['template_key', 'language', 'variables', 'send_policy'])
          && inList(c.template_key, refs.approvedWhatsAppTemplates)
          && c.language === 'pt_BR' && c.send_policy === 'backend_mandatory'
          && (c.variables === undefined || safeVariableNames(c.variables)),
        'META_TEMPLATE_UNVERIFIED',
      );
      break;
    case 'whatsapp_reply':
      requireConfig(
        onlyKeys(c, ['send_policy', 'on_failure'])
          && c.send_policy === 'backend_mandatory'
          && c.on_failure === 'durable_retry_or_handoff',
        'WHATSAPP_SEND_POLICY',
      );
      break;
    case 'email':
      requireConfig(
        onlyKeys(c, ['template_key', 'recipient_source', 'send_policy'])
          && inList(c.template_key, refs.approvedEmailTemplates)
          && c.recipient_source === 'crm_contact'
          && c.send_policy === 'backend_mandatory',
        'EMAIL_TEMPLATE_UNVERIFIED',
      );
      break;
    case 'crm_stage_change':
      requireConfig(
        onlyKeys(c, ['target_stage_id', 'requires'])
          && inList(c.target_stage_id, refs.stageIds)
          && c.requires === 'crm_stage_policy',
        'CRM_STAGE_POLICY_REQUIRED',
      );
      break;
    case 'crm_task':
      requireConfig(onlyKeys(c, ['title']) && named(c.title, 160), 'CRM_TASK_CONFIG');
      break;
    case 'crm_update':
      requireConfig(
        onlyKeys(c, ['field', 'value_source'])
          && inList(c.field, ['next_action.title', 'next_action.due_at', 'notes'])
          && inList(c.value_source, RULE_FIELDS),
        'CRM_UPDATE_FIELD_NOT_ALLOWED',
      );
      break;
    case 'billing_read':
      requireConfig(
        onlyKeys(c, ['source', 'allowed_states'])
          && c.source === 'canonical_billing_order'
          && validNamedList(c.allowed_states, [
            'started', 'awaiting_payment', 'paid', 'failed', 'expired',
          ]),
        'BILLING_READ_SOURCE',
      );
      break;
    case 'wait':
      requireConfig(
        onlyKeys(c, ['duration_seconds', 'cancel_on'])
          && validInteger(c.duration_seconds, 60, 2_592_000)
          && validNamedList(c.cancel_on, [
            'human_takeover', 'opt_out', 'conversation_resolved', 'order_cancelled',
          ]),
        'WAIT_CONFIG_INVALID',
      );
      break;
    case 'human_handoff':
      requireConfig(onlyKeys(c, ['reason']) && named(c.reason, 160), 'HANDOFF_REASON_REQUIRED');
      break;
    case 'notify':
      requireConfig(
        onlyKeys(c, ['channel', 'message_key'])
          && c.channel === 'internal' && named(c.message_key, 100),
        'NOTIFICATION_SCOPE',
      );
      break;
    case 'stop':
    case 'end':
      requireConfig(Object.keys(c).length === 0, 'TERMINAL_CONFIG_NOT_EMPTY');
      break;
  }
  return problems;
}

/**
 * UI/CI preflight only. "canSubmit" means *may request* authorized compilation
 * from the server; it does NOT authorize publishing or dispatch.
 */
export function preflightPublication(
  flow: FlowDefinition, refs: ReferenceSnapshot,
): PublicationPreflight {
  const structural = validateFlow(flow);
  const issues: PreflightIssue[] = structural.issues.map(i => ({
    code: i.code, path: i.path,
  }));
  // JSON imports and network inputs can violate TypeScript types at runtime.
  // Fail closed before iterating or reading untrusted nested properties.
  if (!flow || typeof flow !== 'object' || !Array.isArray(flow.nodes)
    || !Array.isArray(flow.edges)
    || !flow.nodes.every(n => n && typeof n === 'object'
      && typeof n.type === 'string' && n.config && typeof n.config === 'object'
      && !Array.isArray(n.config) && Array.isArray(n.ports))) {
    return { canSubmitForServerValidation: false, issues, requiresServerAuthorization: true };
  }
  const add = (code: string, path: string) => issues.push({ code, path });
  if (flow.schema_version !== PUBLISHABLE_SCHEMA_VERSION) {
    add('CONCEPTUAL_SCHEMA_NOT_PUBLISHABLE', 'schema_version');
  }
  for (const node of flow.nodes) {
    const descriptor = NODE_REGISTRY[node.type];
    const path = 'node:' + node.id;
    if (!descriptor || !descriptor.kinds.includes(flow.kind)) {
      add('NODE_KIND_NOT_ALLOWED', path);
      continue;
    }
    const outputs = declaredOutputs(node);
    const expectedPorts = [...(descriptor.input ? ['in'] : []), ...outputs];
    if (new Set(expectedPorts).size !== expectedPorts.length
      || node.ports.length !== expectedPorts.length
      || !expectedPorts.every(p => node.ports.includes(p))) {
      add('NODE_PORTS_UNSAFE', path);
    }
    if (node.disabled) add('DISABLED_NODE_IN_RELEASE', path);
    for (const code of nodeConfigIssues(node, refs)) add(code, path + '.config');
    for (const port of outputs) {
      if (flow.edges.filter(e => e.source === node.id && e.source_port === port).length !== 1) {
        add('UNCONNECTED_REQUIRED_OUTPUT', path + '.port:' + port);
      }
    }
  }
  for (const edge of flow.edges) {
    const target = flow.nodes.find(n => n.id === edge.target);
    if (target && edge.target_port !== 'in') add('EDGE_TARGET_PORT_NOT_INPUT', 'edge:' + edge.id);
  }
  return {
    canSubmitForServerValidation: issues.length === 0,
    issues,
    requiresServerAuthorization: true,
  };
}
