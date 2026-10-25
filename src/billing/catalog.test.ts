import { describe, expect, it } from 'vitest';
import {
  BILLING_PRICE_SPECS,
  buildBillingQuote,
  buildBillingSelection,
  resolveBillingPrices,
  resolveStripeBillingPrices,
  type StripePriceRecord,
} from '../../supabase/functions/_shared/billing/catalog';

const resolvedPrices = (livemode = false) => Object.fromEntries(
  BILLING_PRICE_SPECS.map(spec => [spec.lookupKey, {
    id: `${livemode ? 'price_live' : 'price_test'}_${spec.lookupKey}`,
    active: true,
    currency: 'brl',
    livemode,
    lookup_key: spec.lookupKey,
    unit_amount: spec.amountCents,
    recurring: spec.recurring,
  } satisfies StripePriceRecord]),
);

describe('buildBillingSelection', () => {
  it('expõe o limite de usuários da seleção comercial versionada', () => {
    expect(buildBillingQuote({ plan: 'Start', cycle: 'monthly', addons: [] }).userLimit).toBe(5);
    expect(buildBillingQuote({ plan: 'Growth', cycle: 'monthly', addons: [] }).userLimit).toBe(10);
    expect(buildBillingQuote({ plan: 'Scale', cycle: 'annual', addons: [] }).userLimit).toBe(20);
  });

  it('mantém assinatura mensal, implantação e landing como itens distintos', () => {
    const result = buildBillingSelection({ plan: 'Growth', cycle: 'monthly', addons: ['landing-page'] }, resolvedPrices());
    expect(result.amountTotal).toBe(337_970);
    expect(result.stripePriceIds).toEqual([
      'price_test_oryneo_growth_monthly',
      'price_test_oryneo_growth_setup',
      'price_test_oryneo_landing_page',
    ]);
    expect(result.recurring?.amountCents).toBe(109_990);
  });

  it('cobra o anual antecipado com dez por cento de desconto', () => {
    const result = buildBillingSelection({ plan: 'Start', cycle: 'annual', addons: [] }, resolvedPrices());
    expect(result.amountTotal).toBe(908_882);
    expect(result.recurring?.intervalLabel).toBe('por ano');
  });

  it('trata tráfego como recorrência trimestral e rejeita seleção fora do catálogo', () => {
    const result = buildBillingSelection({ plan: 'Scale', cycle: 'monthly', addons: ['traffic'] }, resolvedPrices());
    expect(result.items.find(item => item.key === 'traffic')).toMatchObject({ amountCents: 296_970, detail: 'Primeiros 3 meses antecipados' });
    expect(result.trafficRenewalPriceId).toBe('price_test_oryneo_traffic_quarterly');
    expect(() => buildBillingSelection({ plan: 'Enterprise', cycle: 'monthly', addons: [] }, resolvedPrices())).toThrow('INVALID_BILLING_SELECTION');
  });

  it('valida as 24 combinações sem depender de IDs de um ambiente', () => {
    const combinations = ['Start', 'Growth', 'Scale'].flatMap(plan =>
      ['monthly', 'annual'].flatMap(cycle => [
        [], ['landing-page'], ['traffic'], ['landing-page', 'traffic'],
      ].map(addons => ({ plan, cycle, addons }))),
    );
    expect(combinations).toHaveLength(24);
    for (const input of combinations) {
      const result = buildBillingSelection(input, resolvedPrices(true));
      expect(result.stripePriceIds.every(id => id.startsWith('price_live_'))).toBe(true);
      expect(result.amountTotal).toBe(result.items.reduce((sum, item) => sum + item.amountCents, 0));
      expect(result.items.filter(item => item.recurring)).toHaveLength(1);
      expect(result.recurring?.intervalLabel).toBe(input.cycle === 'annual' ? 'por ano' : 'por mês');
      expect(result.items.some(item => item.key === 'traffic')).toBe(input.addons.includes('traffic'));
      expect(result.items.some(item => item.key === 'landing-page')).toBe(input.addons.includes('landing-page'));
      expect(result.trafficRenewalPriceId !== null).toBe(input.addons.includes('traffic'));
    }
  });

  it('fixa a renovação de tráfego em período de três meses no catálogo', () => {
    expect(BILLING_PRICE_SPECS.find(spec => spec.lookupKey === 'oryneo_traffic_quarterly')).toMatchObject({
      amountCents: 296_970,
      recurring: { interval: 'month', interval_count: 3 },
    });
  });
});

describe('resolveBillingPrices', () => {
  it('resolve os 12 lookup keys e rejeita catálogo Stripe do modo oposto', async () => {
    const records = Object.values(resolvedPrices(false));
    const fetchPrices = async () => records;
    const result = await resolveBillingPrices('test', fetchPrices);
    expect(Object.keys(result)).toHaveLength(12);

    await expect(resolveBillingPrices('live', fetchPrices)).rejects.toThrow('BILLING_PRICE_ENVIRONMENT_MISMATCH');
  });

  it('rejeita preço ausente, valor alterado e recorrência divergente', async () => {
    const records = Object.values(resolvedPrices(false));
    await expect(resolveBillingPrices('test', async () => records.slice(1))).rejects.toThrow('BILLING_CATALOG_INCOMPLETE');
    await expect(resolveBillingPrices('test', async () => records.map((price, index) => index === 0 ? { ...price, unit_amount: 1 } : price))).rejects.toThrow('BILLING_PRICE_CONTRACT_MISMATCH');
    await expect(resolveBillingPrices('test', async () => records.map((price, index) => index === 1 ? { ...price, recurring: null } : price))).rejects.toThrow('BILLING_PRICE_CONTRACT_MISMATCH');
  });

  it('consulta lookup keys em lotes de no máximo 10 sem expor o segredo na URL', async () => {
    const records = resolvedPrices(true);
    const batches: string[][] = [];
    const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const keys = url.searchParams.getAll('lookup_keys[]');
      batches.push(keys);
      expect(keys.length).toBeLessThanOrEqual(10);
      expect(url.toString()).not.toContain('rk_live_fixture');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer rk_live_fixture');
      return new Response(JSON.stringify({ data: keys.map(key => records[key]), has_more: false }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    const result = await resolveStripeBillingPrices({
      environment: 'live', livemode: true,
      secretKey: 'rk_live_fixture', publishableKey: 'pk_live_fixture',
    }, fakeFetch as typeof fetch, 1_000);
    expect(Object.keys(result)).toHaveLength(12);
    expect(batches.map(batch => batch.length)).toEqual([10, 2]);
  });
});
