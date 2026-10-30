import { describe, it, expect } from 'vitest';
import { evaluateRule, validateRule, type Rule } from './conditionRules';

const humanAllowed: Rule = { kind: 'group', op: 'all', rules: [
  { kind: 'compare', field: 'conversation.mode', op: 'eq', value: 'sdr_active' },
  { kind: 'compare', field: 'conversation.opted_out', op: 'eq', value: false },
] };

describe('automation conditions (read-only)', () => {
  it('validates AND/OR groups and factual predicates', () => {
    expect(validateRule(humanAllowed).ok).toBe(true);
    expect(evaluateRule(humanAllowed, { conversation: { mode: 'sdr_active', opted_out: false } })).toBe(true);
    expect(evaluateRule(humanAllowed, { conversation: { mode: 'review', opted_out: false } })).toBe(false);
    expect(evaluateRule(humanAllowed, { conversation: { mode: 'sdr_active', opted_out: true } })).toBe(false);
  });
  it('never treats missing facts as a positive negation', () => {
    expect(evaluateRule({ kind: 'compare', field: 'billing.status', op: 'neq', value: 'paid' }, {})).toBe('unknown');
    expect(evaluateRule(humanAllowed, { conversation: { mode: 'sdr_active' } })).toBe('unknown');
  });
  it('uses three-valued AND and OR rather than unsafe JS truthiness', () => {
    const unknown: Rule = { kind: 'compare', field: 'billing.status', op: 'eq', value: 'paid' };
    const falseRule: Rule = { kind: 'compare', field: 'conversation.mode', op: 'eq', value: 'sdr_active' };
    expect(evaluateRule({ kind: 'group', op: 'all', rules: [falseRule, unknown] }, { conversation: { mode: 'review' } })).toBe(false);
    expect(evaluateRule({ kind: 'group', op: 'any', rules: [falseRule, unknown] }, { conversation: { mode: 'review' } })).toBe('unknown');
    expect(evaluateRule({ kind: 'group', op: 'any', rules: [falseRule, unknown] }, { conversation: { mode: 'sdr_active' } })).toBe(true);
  });
  it('requires exact primitive type match', () => {
    const paid: Rule = { kind: 'compare', field: 'billing.paid_verified', op: 'eq', value: true };
    expect(evaluateRule(paid, { billing: { paid_verified: 'true' } })).toBe(false);
    expect(evaluateRule(paid, { billing: { paid_verified: true } })).toBe(true);
    expect(evaluateRule(paid, { billing: { paid_verified: null } })).toBe(false);
  });
  it('rejects prototype traversal, arbitrary operators, and unapproved fields', () => {
    for (const field of ['billing.__proto__', 'auth.jwt', 'conversation.constructor', 'stripe.secret']) {
      expect(validateRule({ kind: 'exists', field }).ok).toBe(false);
    }
    expect(validateRule({ kind: 'compare', field: 'billing.status', op: 'eval', value: 'paid' }).ok).toBe(false);
  });
  it('rejects injected code/extraneous arguments and overly large rule sets', () => {
    expect(validateRule({ kind: 'exists', field: 'billing.status', sql: 'DROP TABLE' }).ok).toBe(false);
    expect(validateRule({ kind: 'one_of', field: 'lead.intent', values: [] }).ok).toBe(false);
    const tooLarge = { kind: 'group', op: 'all', rules: Array.from({ length: 33 }, () => ({ kind: 'exists', field: 'billing.status' })) };
    expect(validateRule(tooLarge).ok).toBe(false);
  });
  it('returns unknown for invalid predicates without running any arbitrary code', () => {
    expect(evaluateRule({ kind: 'dangerous', script: 'process.exit()' }, {})).toBe('unknown');
  });
  it('checks presence without conflating false with missing', () => {
    const exists: Rule = { kind: 'exists', field: 'conversation.opted_out' };
    expect(evaluateRule(exists, { conversation: { opted_out: false } })).toBe(true);
    expect(evaluateRule(exists, { conversation: {} })).toBe(false);
  });
});
