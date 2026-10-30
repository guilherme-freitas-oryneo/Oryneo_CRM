import { describe, expect, it } from 'vitest';
import { simulateFlow, validateFlow, type FlowDefinition } from './flowDefinition';
const base: FlowDefinition = {
  schema_version: '0.1-concept', id: 'composed', name: 'Condição composta', kind: 'sdr',
  status: 'draft', version: 1,
  nodes: [
    { id: 'a', type: 'trigger', label: 'Recebida', position: { x: 0, y: 0 }, ports: ['out'], config: { event_type: 'whatsapp.inbound' } },
    { id: 'b', type: 'condition', label: 'Elegível', position: { x: 0, y: 100 }, ports: ['in', 'yes', 'no'], config: {
      rule: { kind: 'group', op: 'all', rules: [
        { kind: 'compare', field: 'conversation.mode', op: 'eq', value: 'sdr_active' },
        { kind: 'compare', field: 'conversation.opted_out', op: 'eq', value: false },
      ] },
    } },
    { id: 'c', type: 'end', label: 'Parar', position: { x: 0, y: 300 }, ports: ['in'], config: {} },
  ],
  edges: [
    { id: '1', source: 'a', source_port: 'out', target: 'b', target_port: 'in' },
    { id: '2', source: 'b', source_port: 'yes', target: 'c', target_port: 'in' },
    { id: '3', source: 'b', source_port: 'no', target: 'c', target_port: 'in' },
  ],
};
const withConversation = (conversation: Record<string, unknown>) =>
  simulateFlow(base, { eventType: 'whatsapp.inbound', context: { conversation } });
describe('composed conditions inside automation graph', () => {
  it('validates a typed AND/OR condition and simulates yes/no', () => {
    expect(validateFlow(base).ok).toBe(true);
    expect(withConversation({ mode: 'sdr_active', opted_out: false }).issues).toEqual([]);
    expect(withConversation({ mode: 'review', opted_out: false }).issues).toEqual([]);
  });
  it('rejects missing consent/opt-out data rather than guessing false', () => {
    const preview = withConversation({ mode: 'sdr_active' });
    expect(preview.issues[0].code).toBe('CONDITION_UNRESOLVED');
    expect(preview.trace.map(x => x.nodeId)).toEqual(['a']);
  });
  it('fails closed when a composed condition includes a scripting key', () => {
    const flow = structuredClone(base);
    flow.nodes[1].config = { rule: { kind: 'exists', field: 'conversation.mode', script: 'eval()' } };
    expect(validateFlow(flow).issues.map(x => x.code)).toContain('CONDITION_DSL_INVALID');
  });
  it('prevents conflicting legacy and composed predicates in the same config', () => {
    const flow = structuredClone(base);
    flow.nodes[1].config = { ...flow.nodes[1].config, field: 'billing.status', operator: 'eq', value: 'paid' };
    expect(validateFlow(flow).issues.map(x => x.code)).toContain('CONDITION_DSL_INVALID');
  });
  it('fails closed when a simple condition field has not arrived', () => {
    const flow = structuredClone(base);
    flow.nodes[1].config = { field: 'billing.status', operator: 'eq', value: 'paid' };
    const result = simulateFlow(flow, { eventType: 'whatsapp.inbound', context: {} });
    expect(result.issues[0].code).toBe('CONDITION_UNRESOLVED');
  });
});
