import { describe, expect, it } from 'vitest';
import { buildBillingSelection } from '../../supabase/functions/_shared/billing/catalog';

describe('buildBillingSelection', () => {
  it('mantém assinatura mensal, implantação e landing como itens distintos', () => {
    const result = buildBillingSelection({ plan: 'Growth', cycle: 'monthly', addons: ['landing-page'] });
    expect(result.amountTotal).toBe(337_970);
    expect(result.stripePriceIds).toEqual([
      'price_1UQA2dCi4hhgz3b99pwkc49c',
      'price_1UQA2hCi4hhgz3b9V1bWvLDS',
      'price_1UQA2jCi4hhgz3b9aOqzDWBZ',
    ]);
    expect(result.recurring?.amountCents).toBe(109_990);
  });

  it('cobra o anual antecipado com dez por cento de desconto', () => {
    const result = buildBillingSelection({ plan: 'Start', cycle: 'annual', addons: [] });
    expect(result.amountTotal).toBe(908_882);
    expect(result.recurring?.intervalLabel).toBe('por ano');
  });

  it('trata tráfego como recorrência trimestral e rejeita seleção fora do catálogo', () => {
    const result = buildBillingSelection({ plan: 'Scale', cycle: 'monthly', addons: ['traffic'] });
    expect(result.items.find(item => item.key === 'traffic')).toMatchObject({ amountCents: 296_970, detail: 'Primeiros 3 meses antecipados' });
    expect(result.trafficRenewalPriceId).toBe('price_1UQA2kCi4hhgz3b9IrEEF42i');
    expect(() => buildBillingSelection({ plan: 'Enterprise', cycle: 'monthly', addons: [] })).toThrow('INVALID_BILLING_SELECTION');
  });
});
