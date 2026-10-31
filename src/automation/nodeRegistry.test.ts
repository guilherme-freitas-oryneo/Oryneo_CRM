import { describe, expect, it } from 'vitest';
import { NODE_KINDS, NODE_REGISTRY, nodePalette, validRegistryConnection } from './nodeRegistry';

describe('automation node registry (editor metadata only)', () => {
  it('contains each of the 17 conceptual types once', () => {
    expect(NODE_KINDS).toHaveLength(17);
    expect(new Set(NODE_KINDS).size).toBe(17);
    expect(NODE_KINDS.every(type => NODE_REGISTRY[type].title.length > 3)).toBe(true);
  });
  it('does not expose pipeline stage changes as SDR node actions', () => {
    const sdrTypes = nodePalette('sdr').map(item => item.type);
    expect(sdrTypes).toContain('intent_classifier');
    expect(sdrTypes).not.toContain('crm_stage_change');
    expect(sdrTypes).not.toContain('billing_read');
    expect(nodePalette('pipeline').map(item => item.type)).toContain('billing_read');
  });
  it('marks all actual send/update actions as side effects, not harmless preview', () => {
    for (const type of ['whatsapp_template', 'whatsapp_reply', 'email', 'crm_stage_change', 'crm_task', 'crm_update', 'human_handoff', 'notify'] as const) {
      expect(NODE_REGISTRY[type].externalEffect).toBe(true);
    }
    expect(NODE_REGISTRY.billing_read.externalEffect).toBe(false);
  });
  it('prevents links to trigger, from end or into a non-input port', () => {
    expect(validRegistryConnection('trigger', 'out', 'condition', 'in')).toBe(true);
    expect(validRegistryConnection('condition', 'yes', 'crm_task', 'in')).toBe(true);
    expect(validRegistryConnection('end', 'out', 'crm_task', 'in')).toBe(false);
    expect(validRegistryConnection('trigger', 'out', 'trigger', 'in')).toBe(false);
    expect(validRegistryConnection('condition', 'in', 'crm_task', 'in')).toBe(false);
  });
});
