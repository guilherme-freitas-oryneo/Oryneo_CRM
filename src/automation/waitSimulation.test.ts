import { describe, expect, it } from 'vitest';
import { simulateFlow, validateFlow, type FlowDefinition } from './flowDefinition';

const waitGraph: FlowDefinition = {
  schema_version: '1.0.0', id: 'wait-preview', name: 'Aguardar antes de avisar',
  kind: 'pipeline', status: 'draft', version: 1,
  nodes: [
    { id: 'start', type: 'trigger', label: 'Nova oportunidade', position: { x: 0, y: 0 },
      config: { event_type: 'opportunity.created' }, ports: ['out'] },
    { id: 'wait', type: 'wait', label: 'Pausa verificável', position: { x: 0, y: 100 },
      config: { duration_minutes: 60, cancel_on_reply: true }, ports: ['in', 'out', 'timeout'] },
    { id: 'email', type: 'email', label: 'E-mail', position: { x: 0, y: 200 },
      config: { template_id: 'preview-only' }, ports: ['in', 'out', 'error'] },
    { id: 'end', type: 'end', label: 'Fim', position: { x: 0, y: 300 },
      config: {}, ports: ['in'] },
  ],
  edges: [
    { id: 'a', source: 'start', source_port: 'out', target: 'wait', target_port: 'in' },
    { id: 'b', source: 'wait', source_port: 'out', target: 'email', target_port: 'in' },
    { id: 'c', source: 'wait', source_port: 'timeout', target: 'end', target_port: 'in' },
    { id: 'd', source: 'email', source_port: 'out', target: 'end', target_port: 'in' },
    { id: 'e', source: 'email', source_port: 'error', target: 'end', target_port: 'in' },
  ],
};
describe('delayed automation shadow safety', () => {
  it('never plans an action after a wait before the durable resume event', () => {
    expect(validateFlow(waitGraph).ok).toBe(true);
    const preview = simulateFlow(waitGraph, {
      eventType: 'opportunity.created', context: { opportunity: { intent: 'conversation' } },
    });
    expect(preview.dryRun).toBe(true);
    expect(preview.issues).toEqual([]);
    expect(preview.trace.map(step => step.nodeId)).toEqual(['start', 'wait']);
    expect(preview.trace[1].status).toBe('waiting');
    expect(preview.trace.some(step => step.type === 'email')).toBe(false);
  });
});
