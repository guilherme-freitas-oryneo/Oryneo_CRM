import { describe, expect, it } from 'vitest';
import { simulateFlow, validateFlow, type FlowDefinition } from './flowDefinition';

const sample: FlowDefinition = {
  schema_version: '0.1-concept',
  id: 'flow-test',
  name: 'Teste isolado',
  kind: 'pipeline',
  status: 'draft',
  version: 1,
  nodes: [
    {
      id: 'start', type: 'trigger', label: 'Novo lead', position: { x: 0, y: 0 },
      config: { event_type: 'opportunity.created' }, ports: ['out'],
    },
    {
      id: 'check', type: 'condition', label: 'Pago?', position: { x: 0, y: 100 },
      config: { field: 'billing.status', operator: 'eq', value: 'paid' },
      ports: ['in', 'yes', 'no'],
    },
    {
      id: 'task', type: 'crm_task', label: 'Criar tarefa', position: { x: 0, y: 200 },
      config: { title: 'Prosseguir' }, ports: ['in', 'out'],
    },
    {
      id: 'done', type: 'end', label: 'Finalizar', position: { x: 0, y: 300 },
      config: {}, ports: ['in'],
    },
  ],
  edges: [
    { id: 'e1', source: 'start', source_port: 'out', target: 'check', target_port: 'in' },
    { id: 'e2', source: 'check', source_port: 'yes', target: 'task', target_port: 'in' },
    { id: 'e3', source: 'check', source_port: 'no', target: 'done', target_port: 'in' },
    { id: 'e4', source: 'task', source_port: 'out', target: 'done', target_port: 'in' },
  ],
};
const clone = () => structuredClone(sample);

describe('automations: structural graph contract', () => {
  it('accepts a connected and fully branched draft graph', () => {
    expect(validateFlow(sample)).toEqual({ ok: true, issues: [] });
  });
  it('rejects an orphan connection before simulation', () => {
    const graph = clone();
    graph.edges[0].target = 'missing';
    const result = validateFlow(graph);
    expect(result.ok).toBe(false);
    expect(result.issues.map(issue => issue.code)).toContain('ORPHAN_EDGE');
  });
  it('rejects a missing decision branch', () => {
    const graph = clone();
    graph.edges = graph.edges.filter(edge => edge.id !== 'e3');
    expect(validateFlow(graph).issues.map(issue => issue.code)).toContain('UNCONNECTED_BRANCH');
  });
  it('rejects a cyclic graph', () => {
    const graph = clone();
    graph.edges.push({ id: 'cycle', source: 'task', source_port: 'out', target: 'check', target_port: 'in' });
    expect(validateFlow(graph).issues.map(issue => issue.code)).toContain('CYCLE');
  });
  it('rejects arbitrary predicate expressions and dangerous paths', () => {
    const graph = clone();
    graph.nodes[1].config = { field: 'billing.__proto__.status', operator: 'eq', value: 'paid' };
    expect(validateFlow(graph).issues.map(issue => issue.code)).toContain('CONDITION_FIELD');
  });
  it('rejects two edges from the same output port', () => {
    const graph = clone();
    graph.edges.push({ id: 'extra', source: 'check', source_port: 'yes', target: 'done', target_port: 'in' });
    expect(validateFlow(graph).issues.map(issue => issue.code)).toContain('AMBIGUOUS_PORT');
  });
});

describe('automations: isolated dry-run', () => {
  it('follows yes and only plans the CRM action without emitting it', () => {
    const result = simulateFlow(sample, {
      eventType: 'opportunity.created', context: { billing: { status: 'paid' } },
    });
    expect(result.dryRun).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.trace.map(step => step.nodeId)).toEqual(['start', 'check', 'task', 'done']);
    expect(result.trace[2].status).toBe('planned');
  });
  it('follows no without scheduling a CRM action', () => {
    const result = simulateFlow(sample, {
      eventType: 'opportunity.created', context: { billing: { status: 'awaiting_payment' } },
    });
    expect(result.trace.map(step => step.nodeId)).toEqual(['start', 'check', 'done']);
  });
  it('cannot treat unverified event types as matching the trigger', () => {
    const result = simulateFlow(sample, {
      eventType: 'payment.paid', context: { billing: { status: 'paid' } },
    });
    expect(result.trace).toEqual([]);
    expect(result.issues[0].code).toBe('EVENT_NOT_MATCHED');
  });
  it('does not execute an invalid graph', () => {
    const graph = clone();
    graph.edges[0].target = 'deleted';
    expect(simulateFlow(graph, {
      eventType: 'opportunity.created', context: { billing: { status: 'paid' } },
    }).trace).toEqual([]);
  });
  it('stops fail-closed at a disabled node', () => {
    const graph = clone();
    graph.nodes[2].disabled = true;
    const result = simulateFlow(graph, {
      eventType: 'opportunity.created', context: { billing: { status: 'paid' } },
    });
    expect(result.issues[0].code).toBe('DISABLED_NODE');
    expect(result.trace.map(step => step.nodeId)).toEqual(['start', 'check']);
  });
});
