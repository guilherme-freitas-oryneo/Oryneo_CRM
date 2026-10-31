import { describe, expect, it } from 'vitest';
import { preflightPublication, type ReferenceSnapshot } from './publicationPreflight';
import type { FlowDefinition, FlowNode } from './flowDefinition';

const refs: ReferenceSnapshot = {
  eventTypes: ['opportunity.created', 'whatsapp.inbound'],
  stageIds: ['stage-verified'],
  approvedWhatsAppTemplates: ['oryneo_reuniao_confirmada_v3'],
  approvedEmailTemplates: ['e01_lead_received'],
  knowledgeReleaseIds: ['playbook-approved-1'],
  intentDictionaryIds: ['approved-intents-1'],
};
const basic = (): FlowDefinition => ({
  id: 'safe', schema_version: '1.0.0', name: 'Atendimento interno', status: 'draft',
  version: 1, kind: 'pipeline',
  nodes: [
    { id: 'trigger', type: 'trigger', label: 'Nova oportunidade', position: { x: 0, y: 0 }, config: { event_type: 'opportunity.created' }, ports: ['out'] },
    { id: 'task', type: 'crm_task', label: 'Atribuir tarefa', position: { x: 0, y: 100 }, config: { title: 'Contatar empresa' }, ports: ['in', 'out'] },
    { id: 'end', type: 'end', label: 'Fim', position: { x: 0, y: 200 }, config: {}, ports: ['in'] },
  ],
  edges: [
    { id: '1', source: 'trigger', source_port: 'out', target: 'task', target_port: 'in' },
    { id: '2', source: 'task', source_port: 'out', target: 'end', target_port: 'in' },
  ],
});
const codes = (flow: FlowDefinition) => preflightPublication(flow, refs).issues.map(issue => issue.code);
describe('automation publication preflight never grants authorization', () => {
  it('marks a well-formed internal draft only as eligible for server review', () => {
    expect(preflightPublication(basic(), refs)).toEqual({
      canSubmitForServerValidation: true, issues: [], requiresServerAuthorization: true,
    });
  });
  it('blocks the conceptual ZIP schema from publication', () => {
    const draft = basic();
    draft.schema_version = '0.1-concept';
    expect(codes(draft)).toContain('CONCEPTUAL_SCHEMA_NOT_PUBLISHABLE');
  });
  it('rejects unapproved event types and node config code injection', () => {
    const draft = basic();
    draft.nodes[0].config = { event_type: 'billing.charge_now', javascript: 'fetch()' };
    expect(codes(draft)).toContain('TRIGGER_UNVERIFIED');
  });
  it('rejects unknown stage, free-form mutations and missing stage policy', () => {
    const draft = basic();
    draft.nodes[1] = {
      ...draft.nodes[1], type: 'crm_stage_change',
      config: { target_stage_id: 'unverified', requires: 'none' },
    };
    expect(codes(draft)).toContain('CRM_STAGE_POLICY_REQUIRED');
  });
  it('will not allow the SDR to mutate the commercial pipeline directly', () => {
    const draft = basic();
    draft.kind = 'sdr';
    draft.nodes[1] = {
      ...draft.nodes[1], type: 'crm_stage_change',
      config: { target_stage_id: 'stage-verified', requires: 'crm_stage_policy' },
    };
    expect(codes(draft)).toContain('NODE_KIND_NOT_ALLOWED');
  });
  it('requires every side-effect error branch to be wired', () => {
    const draft = basic();
    draft.nodes[1] = {
      ...draft.nodes[1], type: 'whatsapp_template',
      config: {
        template_key: 'oryneo_reuniao_confirmada_v3',
        language: 'pt_BR', send_policy: 'backend_mandatory',
      }, ports: ['in', 'out', 'error'],
    };
    expect(codes(draft)).toContain('UNCONNECTED_REQUIRED_OUTPUT');
    draft.edges.push({
      id: '3', source: 'task', source_port: 'error', target: 'end', target_port: 'in',
    });
    expect(preflightPublication(draft, refs).canSubmitForServerValidation).toBe(true);
  });
  it('blocks non-approved WhatsApp templates and arbitrary recipients/URLs', () => {
    const draft = basic();
    draft.nodes[1] = {
      ...draft.nodes[1], type: 'whatsapp_template',
      config: {
        template_key: 'not_approved', language: 'pt_BR',
        send_policy: 'backend_mandatory', recipient_phone: '+5500000',
      }, ports: ['in', 'out', 'error'],
    };
    expect(codes(draft)).toContain('META_TEMPLATE_UNVERIFIED');
  });
  it('does not permit a pretend local client approval of email routing', () => {
    const draft = basic();
    draft.nodes[1] = {
      ...draft.nodes[1], type: 'email',
      config: { template_key: 'e01_lead_received', recipient_source: 'custom_url', send_policy: 'backend_mandatory' },
      ports: ['in', 'out', 'error'],
    };
    expect(codes(draft)).toContain('EMAIL_TEMPLATE_UNVERIFIED');
  });
  it('rejects unsafe wait timers, missing cancellation and disconnected timeout', () => {
    const draft = basic();
    draft.nodes[1] = {
      ...draft.nodes[1], type: 'wait',
      config: { duration_seconds: 0, cancel_on: [] },
      ports: ['in', 'out', 'timeout'],
    };
    expect(codes(draft)).toEqual(expect.arrayContaining(['WAIT_CONFIG_INVALID', 'UNCONNECTED_REQUIRED_OUTPUT']));
  });
  it('does not accept edges connected to output ports as targets', () => {
    const draft = basic();
    draft.nodes[1].ports = ['in', 'out', 'special'];
    draft.edges[0].target_port = 'special';
    expect(codes(draft)).toEqual(expect.arrayContaining(['NODE_PORTS_UNSAFE', 'EDGE_TARGET_PORT_NOT_INPUT']));
  });
  it('rejects disabled action nodes and missing terminal config hygiene', () => {
    const draft = basic();
    draft.nodes[1].disabled = true;
    draft.nodes[2].config = { shell: 'none' };
    expect(codes(draft)).toEqual(expect.arrayContaining(['DISABLED_NODE_IN_RELEASE', 'TERMINAL_CONFIG_NOT_EMPTY']));
  });
  it('rejects an AI generator with configurable bypassed guardrails', () => {
    const draft = basic();
    draft.kind = 'sdr';
    draft.nodes[1] = {
      ...draft.nodes[1], type: 'ai_generate',
      config: { guardrails: ['be_persuasive'], model: 'unapproved-model' },
      ports: ['in', 'out', 'error'],
    };
    expect(codes(draft)).toContain('AI_GUARDRAILS_REQUIRED');
  });
});
