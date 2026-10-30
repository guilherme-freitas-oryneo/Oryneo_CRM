/**
 * Read-only shadow planner for ORYNEO.
 *
 * No network/storage imports. It NEVER invokes a provider, mutates CRM, advances
 * a payment or treats a simulated outcome as a confirmed business event.
 * Durable deduplication must be enforced by the SQL UNIQUE constraints;
 * these hashes merely provide stable proposed keys.
 */
import { simulateFlow, validateFlow, type FlowDefinition, type FlowTrace } from './flowDefinition';
import { NODE_REGISTRY } from './nodeRegistry';

export type ShadowEvent = {
  workspaceId: string;
  flowVersionId: string;
  source: 'crm' | 'whatsapp' | 'stripe' | 'mail' | 'landing';
  eventId: string;
  eventType: string;
  context: Record<string, unknown>;
};
export type ShadowIssue = { code: string; path: string };
export type PlannedAction = { nodeId: string; actionKey: string; type: string };
export type ShadowPlan = {
  shadowOnly: true;
  dispatchAuthorized: false;
  state: 'blocked' | 'completed' | 'awaiting_server_outcome';
  activationKey: string | null;
  trace: FlowTrace[];
  actions: PlannedAction[];
  issues: ShadowIssue[];
};

const IDENTIFIER = /^[a-zA-Z0-9_.:-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEEDS_SERVER_RESULT = new Set([
  'intent_classifier', 'knowledge_lookup', 'ai_generate', 'billing_read', 'wait',
  'human_handoff', 'whatsapp_template', 'whatsapp_reply', 'email', 'crm_stage_change',
  'crm_task', 'crm_update', 'notify',
]);
async function hashParts(parts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Simulates only decisions supported by actual context. Stops at the first
 * side effect / unknown server result. No path beyond that point is asserted.
 */
export async function planShadowExecution(
  graph: FlowDefinition,
  event: ShadowEvent,
): Promise<ShadowPlan> {
  const rejected = (issues: ShadowIssue[]): ShadowPlan => ({
    shadowOnly: true, dispatchAuthorized: false, state: 'blocked',
    activationKey: null, trace: [], actions: [], issues,
  });
  const valid = validateFlow(graph);
  if (!valid.ok) return rejected(valid.issues.map(x => ({ code: x.code, path: x.path })));
  if (graph.schema_version !== '1.0.0' || graph.status !== 'published') {
    return rejected([{ code: 'PUBLISHED_SNAPSHOT_REQUIRED', path: 'graph' }]);
  }
  if (!UUID.test(event.workspaceId) || !UUID.test(event.flowVersionId)
    || !IDENTIFIER.test(event.eventId) || !IDENTIFIER.test(event.eventType)
    || !['crm', 'whatsapp', 'stripe', 'mail', 'landing'].includes(event.source)
    || !event.context || typeof event.context !== 'object'
    || Array.isArray(event.context)) {
    return rejected([{ code: 'EVENT_ENVELOPE_INVALID', path: 'event' }]);
  }
  const activationKey = await hashParts([
    event.workspaceId, event.flowVersionId, event.source, event.eventId,
  ]);
  const preview = simulateFlow(graph, { eventType: event.eventType, context: event.context });
  const trace: FlowTrace[] = [];
  const actions: PlannedAction[] = [];
  let pending = false;
  for (const step of preview.trace) {
    trace.push(step);
    const descriptor = NODE_REGISTRY[step.type];
    if (!descriptor) return rejected([{ code: 'NODE_DESCRIPTOR_MISSING', path: 'node:' + step.nodeId }]);
    if (descriptor.externalEffect) {
      actions.push({
        nodeId: step.nodeId,
        type: step.type,
        actionKey: await hashParts([activationKey, step.nodeId, step.type]),
      });
    }
    if (NEEDS_SERVER_RESULT.has(step.type)) {
      pending = true;
      break;
    }
  }
  const issues = preview.issues.map(issue => ({ code: issue.code, path: issue.path }));
  return {
    shadowOnly: true, dispatchAuthorized: false, activationKey, trace, actions,
    state: issues.length ? 'blocked' : pending ? 'awaiting_server_outcome' : 'completed',
    issues,
  };
}
