import { describe, expect, it } from 'vitest';
import { ALLOWED_EVENTS, canonicalJson, preparePublication, validatePublication, type PublicationRefs } from './flowPublication';
import type { FlowDefinition } from './flowDefinition';

const tpl = '00000000-0000-4000-8000-000000000001';
const refs: PublicationRefs = {
  approvedTemplateIds: [tpl], publishedKnowledgeIds: [], allowedStageIds: [],
  enabledIntentDictionaryIds: [], approvedEmailTemplateIds: [],
  approvedPromptRefs: [], approvedReplyRefs: [],
};
const base = (): FlowDefinition => ({
  schema_version: '1.0.0', id: 'flow-a', name: 'Fluxo seguro', kind: 'sdr',
  status: 'draft', version: 1,
  nodes: [
    { id: 'trigger', type: 'trigger', label: 'Recebida', position: { x: 0, y: 0 }, config: { event_type: 'conversation.inbound' }, ports: ['out'] },
    { id: 'stop', type: 'end', label: 'Finalizar', position: { x: 0, y: 180 }, config: {}, ports: ['in'] },
  ],
  edges: [{ id: 'first', source: 'trigger', source_port: 'out', target: 'stop', target_port: 'in' }],
});
describe('ORYNEO publication contract', () => {
  it('allows a structurally complete draft with server-known event types', () => {
    expect(ALLOWED_EVENTS.has('conversation.inbound')).toBe(true);
    expect(validatePublication(base(), refs)).toEqual({ ok: true, issues: [] });
  });
  it('rejects the conceptual ZIP graph schema', () => {
    const draft = base(); draft.schema_version = '0.1-concept';
    expect(validatePublication(draft, refs).issues.map(x => x.code)).toContain('CONCEPT_NOT_PUBLISHABLE');
  });
  it('rejects any published version as input and disabled nodes', () => {
    const graph = base(); graph.status = 'published'; graph.nodes[1].disabled = true;
    const codes = validatePublication(graph, refs).issues.map(x => x.code);
    expect(codes).toContain('NOT_DRAFT');
    expect(codes).toContain('DISABLED_NODE');
  });
  it('requires approval registry reference before WhatsApp template is publishable', () => {
    const graph = base();
    graph.nodes.splice(1, 0, {
      id: 'wa', type: 'whatsapp_template', label: 'Envio', position: { x: 0, y: 90 },
      ports: ['in', 'out', 'error'], config: { template_registry_id: tpl, locale: 'pt_BR' },
    });
    graph.edges = [
      { id: 'e1', source: 'trigger', source_port: 'out', target: 'wa', target_port: 'in' },
      { id: 'e2', source: 'wa', source_port: 'out', target: 'stop', target_port: 'in' },
      { id: 'e3', source: 'wa', source_port: 'error', target: 'stop', target_port: 'in' },
    ];
    expect(validatePublication(graph, refs).ok).toBe(true);
    expect(validatePublication(graph, { ...refs, approvedTemplateIds: [] }).issues.map(x => x.code))
      .toContain('TEMPLATE_NOT_APPROVED');
  });
  it('blocks free-form code and unauthorized prompt identifiers', () => {
    const graph = base(); graph.nodes[1] = {
      id: 'ai', type: 'ai_generate', label: 'IA', position: { x: 0, y: 100 },
      config: { prompt_ref: 'unreviewed', max_tokens: 500, javascript: 'fetch()' },
      ports: ['in', 'out', 'error'],
    };
    graph.nodes.push({ id: 'finish', type: 'end', label: 'Done', position: { x: 0, y: 200 }, config: {}, ports: ['in'] });
    graph.edges = [
      { id: 'e1', source: 'trigger', source_port: 'out', target: 'ai', target_port: 'in' },
      { id: 'e2', source: 'ai', source_port: 'out', target: 'finish', target_port: 'in' },
      { id: 'e3', source: 'ai', source_port: 'error', target: 'finish', target_port: 'in' },
    ];
    expect(validatePublication(graph, refs).issues.map(x => x.code)).toContain('AI_CONFIG_INVALID');
  });
  it('never accepts nodes from the wrong flow kind', () => {
    const graph = base(); graph.nodes[1].type = 'crm_stage_change';
    graph.nodes[1].config = { target_stage_id: tpl };
    graph.nodes[1].ports = ['in', 'out'];
    graph.nodes.push({ id: 'finish', type: 'end', label: 'Done', position: { x: 0, y: 200 }, config: {}, ports: ['in'] });
    graph.edges = [
      { id: 'e1', source: 'trigger', source_port: 'out', target: 'stop', target_port: 'in' },
      { id: 'e2', source: 'stop', source_port: 'out', target: 'finish', target_port: 'in' },
    ];
    expect(validatePublication(graph, refs).ok).toBe(false);
  });
  it('creates an immutable-at-rest canonical hash without external requests', async () => {
    const graph = base();
    const result = await preparePublication(graph, refs);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.status).toBe('published');
      expect(result.contentSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(graph.status).toBe('draft');
    }
    const again = await preparePublication(graph, refs);
    expect(again).toEqual(result);
  });
  it('produces the same canonical encoding regardless of object key order', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    expect(canonicalJson([null, 2, false])).toBe('[null,2,false]');
    expect(canonicalJson({ a: undefined, b: true })).toBe('{"b":true}');
  });
  it('does not run or traverse an invalid untrusted graph', () => {
    expect(validatePublication({ ...base(), nodes: null } as unknown as FlowDefinition, refs).ok).toBe(false);
  });
});
