import { describe, expect, it } from 'vitest';
import { nextPlanChargeAt, nextTrafficChargeAt, resolveRenewalCharge } from '../../supabase/functions/_shared/billing/billing-center-policy';

describe('CRM billing center policy', () => {
  it('uses only the recurring amount from the accepted plan quote', () => {
    const result = resolveRenewalCharge({ plan: 'Growth', cycle: 'monthly', addons: ['landing-page'] }, 'plan');
    expect(result).toEqual({
      kind: 'plan_monthly',
      amountCents: 109_990,
      label: 'Plano Growth · renovação mensal',
    });
  });

  it('keeps quarterly traffic renewal separate from plan and setup charges', () => {
    const result = resolveRenewalCharge({ plan: 'Scale', cycle: 'annual', addons: ['traffic'] }, 'traffic');
    expect(result).toEqual({
      kind: 'traffic_quarterly',
      amountCents: 296_970,
      label: 'Gestão de tráfego pago · renovação trimestral',
    });
  });

  it('rejects traffic billing when the accepted order did not include traffic', () => {
    expect(() => resolveRenewalCharge({ plan: 'Start', cycle: 'monthly', addons: [] }, 'traffic')).toThrow('NOT_CONTRACTED');
  });

  it('calculates plan and quarterly traffic dates from contract start in UTC', () => {
    expect(nextPlanChargeAt('2026-01-15T12:00:00.000Z', 'monthly')).toBe('2026-02-15T12:00:00.000Z');
    expect(nextPlanChargeAt('2026-01-15T12:00:00.000Z', 'annual')).toBe('2027-01-15T12:00:00.000Z');
    expect(nextTrafficChargeAt('2026-01-15T12:00:00.000Z')).toBe('2026-04-15T12:00:00.000Z');
    expect(nextPlanChargeAt('2026-01-31T12:00:00.000Z', 'monthly')).toBe('2026-02-28T12:00:00.000Z');
    expect(nextTrafficChargeAt('2026-11-30T12:00:00.000Z')).toBe('2027-02-28T12:00:00.000Z');
  });
});
