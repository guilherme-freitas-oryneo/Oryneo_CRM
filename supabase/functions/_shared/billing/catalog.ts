import type { BillingEnvironment, BillingEnvironmentConfig } from './environment.ts';

export type BillingPlan = 'Start' | 'Growth' | 'Scale';
export type BillingCycle = 'monthly' | 'annual';
export type BillingAddon = 'landing-page' | 'traffic';

type Selection = { plan: string; cycle: string; addons: string[] };
type QuoteItem = { key: string; label: string; detail: string; amountCents: number; lookupKey: string; recurring: boolean };
type Recurrence = { interval: 'month' | 'year'; interval_count: number } | null;

export type BillingPriceSpec = {
  lookupKey: string;
  amountCents: number;
  recurring: Recurrence;
};

export type StripePriceRecord = {
  id: string;
  active: boolean;
  currency: string;
  livemode: boolean;
  lookup_key: string | null;
  unit_amount: number | null;
  recurring: { interval: string; interval_count: number } | null;
};

export type ResolvedBillingPrices = Record<string, StripePriceRecord>;

export const BILLING_PRICE_SPECS: readonly BillingPriceSpec[] = [
  { lookupKey: 'oryneo_start_monthly', amountCents: 74_990, recurring: { interval: 'month', interval_count: 1 } },
  { lookupKey: 'oryneo_start_annual', amountCents: 809_892, recurring: { interval: 'year', interval_count: 1 } },
  { lookupKey: 'oryneo_growth_monthly', amountCents: 109_990, recurring: { interval: 'month', interval_count: 1 } },
  { lookupKey: 'oryneo_growth_annual', amountCents: 1_187_892, recurring: { interval: 'year', interval_count: 1 } },
  { lookupKey: 'oryneo_scale_monthly', amountCents: 147_990, recurring: { interval: 'month', interval_count: 1 } },
  { lookupKey: 'oryneo_scale_annual', amountCents: 1_598_292, recurring: { interval: 'year', interval_count: 1 } },
  { lookupKey: 'oryneo_start_setup', amountCents: 98_990, recurring: null },
  { lookupKey: 'oryneo_growth_setup', amountCents: 138_990, recurring: null },
  { lookupKey: 'oryneo_scale_setup', amountCents: 184_990, recurring: null },
  { lookupKey: 'oryneo_landing_page', amountCents: 88_990, recurring: null },
  { lookupKey: 'oryneo_traffic_initial_quarter', amountCents: 296_970, recurring: null },
  { lookupKey: 'oryneo_traffic_quarterly', amountCents: 296_970, recurring: { interval: 'month', interval_count: 3 } },
] as const;

const plans = {
  Start: {
    monthly: { amount: 74_990, lookupKey: 'oryneo_start_monthly' },
    annual: { amount: 809_892, lookupKey: 'oryneo_start_annual' },
    setup: { amount: 98_990, lookupKey: 'oryneo_start_setup' },
  },
  Growth: {
    monthly: { amount: 109_990, lookupKey: 'oryneo_growth_monthly' },
    annual: { amount: 1_187_892, lookupKey: 'oryneo_growth_annual' },
    setup: { amount: 138_990, lookupKey: 'oryneo_growth_setup' },
  },
  Scale: {
    monthly: { amount: 147_990, lookupKey: 'oryneo_scale_monthly' },
    annual: { amount: 1_598_292, lookupKey: 'oryneo_scale_annual' },
    setup: { amount: 184_990, lookupKey: 'oryneo_scale_setup' },
  },
} as const;

const addons = {
  'landing-page': { label: 'Landing page de conversão', detail: 'Cobrança única', amount: 88_990, lookupKey: 'oryneo_landing_page', recurring: false },
  traffic: { label: 'Gestão de tráfego pago', detail: 'Primeiros 3 meses antecipados', amount: 296_970, lookupKey: 'oryneo_traffic_initial_quarter', renewalLookupKey: 'oryneo_traffic_quarterly', recurring: false },
} as const;

const invalid = () => { throw new Error('INVALID_BILLING_SELECTION'); };

function sameRecurrence(actual: StripePriceRecord['recurring'], expected: Recurrence): boolean {
  if (!actual || !expected) return actual === null && expected === null;
  return actual.interval === expected.interval && actual.interval_count === expected.interval_count;
}

export async function resolveBillingPrices(
  environment: BillingEnvironment,
  fetchPrices: (lookupKeys: string[]) => Promise<StripePriceRecord[]>,
): Promise<ResolvedBillingPrices> {
  const records = await fetchPrices(BILLING_PRICE_SPECS.map(spec => spec.lookupKey));
  if (records.length !== BILLING_PRICE_SPECS.length) throw new Error('BILLING_CATALOG_INCOMPLETE');
  const resolved: ResolvedBillingPrices = {};
  for (const spec of BILLING_PRICE_SPECS) {
    const matches = records.filter(price => price.lookup_key === spec.lookupKey);
    if (matches.length !== 1) throw new Error('BILLING_CATALOG_INCOMPLETE');
    const price = matches[0];
    if (price.livemode !== (environment === 'live')) throw new Error('BILLING_PRICE_ENVIRONMENT_MISMATCH');
    if (!price.active || price.currency !== 'brl' || price.unit_amount !== spec.amountCents ||
        !price.id.startsWith('price_') || !sameRecurrence(price.recurring, spec.recurring)) {
      throw new Error('BILLING_PRICE_CONTRACT_MISMATCH');
    }
    resolved[spec.lookupKey] = price;
  }
  return resolved;
}

const catalogCache = new Map<BillingEnvironment, { expiresAt: number; value: Promise<ResolvedBillingPrices> }>();

export async function resolveStripeBillingPrices(
  config: BillingEnvironmentConfig,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<ResolvedBillingPrices> {
  const cached = catalogCache.get(config.environment);
  if (cached && cached.expiresAt > now) return cached.value;
  const value = resolveBillingPrices(config.environment, async lookupKeys => {
    const batches: string[][] = [];
    for (let index = 0; index < lookupKeys.length; index += 10) batches.push(lookupKeys.slice(index, index + 10));
    const results = await Promise.all(batches.map(async batch => {
      const query = new URLSearchParams({ active: 'true', limit: '100' });
      batch.forEach(key => query.append('lookup_keys[]', key));
      const response = await fetchImpl(`https://api.stripe.com/v1/prices?${query}`, {
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          'Stripe-Version': '2026-08-26.dahlia',
        },
      });
      if (!response.ok) throw new Error('BILLING_CATALOG_UNAVAILABLE');
      const body = await response.json();
      if (!Array.isArray(body?.data) || body.has_more) throw new Error('BILLING_CATALOG_INCOMPLETE');
      return body.data as StripePriceRecord[];
    }));
    return results.flat();
  });
  catalogCache.set(config.environment, { expiresAt: now + 5 * 60_000, value });
  try {
    return await value;
  } catch (error) {
    if (catalogCache.get(config.environment)?.value === value) catalogCache.delete(config.environment);
    throw error;
  }
}

function priceId(prices: ResolvedBillingPrices, lookupKey: string): string {
  const value = prices[lookupKey]?.id;
  if (!value) throw new Error('BILLING_CATALOG_INCOMPLETE');
  return value;
}

export function buildBillingQuote(input: Selection) {
  if (!(input.plan in plans) || !['monthly', 'annual'].includes(input.cycle)) invalid();
  const uniqueAddons = [...new Set(input.addons || [])];
  if (uniqueAddons.some(key => !(key in addons))) invalid();
  const planName = input.plan as BillingPlan;
  const cycle = input.cycle as BillingCycle;
  const plan = plans[planName];
  const subscription = plan[cycle];
  const items: QuoteItem[] = [
    { key: `${planName.toLowerCase()}_${cycle}`, label: `Plano ${planName}`, detail: cycle === 'annual' ? 'Assinatura anual antecipada' : 'Assinatura mensal', amountCents: subscription.amount, lookupKey: subscription.lookupKey, recurring: true },
    { key: `${planName.toLowerCase()}_setup`, label: 'Implantação', detail: 'Cobrança única', amountCents: plan.setup.amount, lookupKey: plan.setup.lookupKey, recurring: false },
    ...uniqueAddons.map(key => {
      const addon = addons[key as BillingAddon];
      return { key, label: addon.label, detail: addon.detail, amountCents: addon.amount, lookupKey: addon.lookupKey, recurring: addon.recurring };
    }),
  ];
  return {
    catalogVersion: '2026-10-13',
    plan: planName,
    cycle,
    items,
    amountTotal: items.reduce((total, item) => total + item.amountCents, 0),
    trafficRenewalLookupKey: uniqueAddons.includes('traffic') ? addons.traffic.renewalLookupKey : null,
    recurring: {
      label: `Plano ${planName}`,
      amountCents: subscription.amount,
      intervalLabel: cycle === 'annual' ? 'por ano' : 'por mês',
    },
  };
}

export function buildBillingSelection(input: Selection, prices: ResolvedBillingPrices) {
  const quote = buildBillingQuote(input);
  const items = quote.items.map(({ lookupKey, ...item }) => ({
    ...item,
    stripePriceId: priceId(prices, lookupKey),
  }));
  return {
    ...quote,
    items,
    stripePriceIds: items.map(item => item.stripePriceId),
    trafficRenewalPriceId: quote.trafficRenewalLookupKey
      ? priceId(prices, quote.trafficRenewalLookupKey)
      : null,
  };
}
