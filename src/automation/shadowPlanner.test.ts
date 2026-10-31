import { describe, expect, it } from 'vitest';
import { planShadowExecution, type ShadowEvent } from './shadowPlanner';
import type { FlowDefinition } from './flowDefinition';

const event: ShadowEvent = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  flowVersionId: '22222222-2222-4222-8222-222222222222',
  source: 'crm', eventId: 'event-42', eventType: 'opportunity.created', context: {},
};
const graph = (): FlowDefinition => ({
  schema_version: '1.0.0', id: 'event-handler', name: 'Fluxo isolado',
  kind: 'pipeline', status: 'published', version: 1,
  nodes: [
    { id: 'start', type: 'trigger', label: 'Novo negócio', position: { x: 0, y: 0 }, ports: ['out'], config: { event_type: 'opportunity.created' } },
    { id: 'task', type: 'crm_task', label: 'Contato inicial', position: { x: 0, y: 100 }, ports: ['in', 'out'], config: { title: 'Ligar para lead' } },
    { id: 'done', type: 'end', label: 'Concluído', position: { x: 0, y: 200 }, ports: ['in'], config: {} },
  ],
  edges: [
    { id: 'e1', source: 'start', source_port: 'out', target: 'task', target_port: 'in' },
    { id: 'e2', source: 'task', source_port: 'out', target: 'done', target_port: 'in' },
  ],
});
describe('automations: no-dispatch shadow planner', () => {
  it('uses repeatable activation/action keys and never authorizes a dispatch', async () => {
    const first = await planShadowExecution(graph(), event);
    const replay = await planShadowExecution(graph(), event);
    expect(first).toEqual(replay);
    expect(first.shadowOnly).toBe(true);
    expect(first.dispatchAuthorized).toBe(false);
    expect(first.state).toBe('awaiting_server_outcome');
    expect(first.trace.map(step => step.nodeId)).toEqual(['start', 'task']);
    expect(first.actions).toHaveLength(1);
    expect(first.actions[0].actionKey).toMatch(/^[0-9a-f]{64}$/);
    expect(first.trace.find(step => step.nodeId === 'done')).toBeUndefined();
  });
  it('separates event and workspace keys for deduplication by SQL UNIQUE', async () => {
    const base = await planShadowExecution(graph(), event);
    const next = await planShadowExecution(graph(), { ...event, eventId: 'event-43' });
    const elsewhere = await planShadowExecution(graph(), {
      ...event, workspaceId: '33333333-3333-4333-8333-333333333333',
    });
    expect(base.activationKey).not.toBe(next.activationKey);
    expect(base.activationKey).not.toBe(elsewhere.activationKey);
  });
  it('never interprets a missing condition input as consent to continue', async () => {
    const conditional = graph();
    conditional.nodes[1] = {
      ...conditional.nodes[1], type: 'condition',
      ports: ['in', 'yes', 'no'],
      config: { field: 'billing.paid_verified', operator: 'eq', value: true },
    };
    conditional.edges[1].source_port = 'yes';
    conditional.edges.push({
      id: 'e3', source: 'task', source_port: 'no', target: 'done', target_port: 'in',
    });
    const result = await planShadowExecution(conditional, event);
    expect(result.state).toBe('blocked');
    expect(result.issues.map(x => x.code)).toContain('CONDITION_UNRESOLVED');
    expect(result.actions).toEqual([]);
  });
  it('refuses schema drafts and malformed envelopes rather than planning effects', async () => {
    const draft = graph();
    draft.status = 'draft';
    expect((await planShadowExecution(draft, event)).issues[0].code).toBe('PUBLISHED_SNAPSHOT_REQUIRED');
    expect((await planShadowExecution(graph(), { ...event, source: 'crm', eventId: '../../sensitive' })).issues[0].code).toBe('EVENT_ENVELOPE_INVALID');
  });
  it('stops at a timer without assuming that future steps were executed', async () => {
    const timed = graph();
    timed.nodes[1] = {
      ...timed.nodes[1], type: 'wait', ports: ['in', 'out'], config: { duration_seconds: 600 },
    };
    const result = await planShadowExecution(timed, event);
    expect(result.shadowOnly).toBe(true);
    expect(result.state).toBe('awaiting_server_outcome');
    expect(result.actions).toEqual([]);
    expect(result.trace.map(x => x.nodeId)).toEqual(['start', 'task']);
  });
});
