export type BillingPlan = 'Start' | 'Growth' | 'Scale';
export type BillingCycle = 'monthly' | 'annual';
export type BillingAddon = 'landing-page' | 'traffic';

type Selection = { plan: string; cycle: string; addons: string[] };
type Item = { key: string; label: string; detail: string; amountCents: number; stripePriceId: string; recurring: boolean };

const plans = {
  Start: {
    monthly: { amount: 74_990, price: 'price_1UQA2aCi4hhgz3b9eZZSVknm' },
    annual: { amount: 809_892, price: 'price_1UQA2bCi4hhgz3b9UWipxyu5' },
    setup: { amount: 98_990, price: 'price_1UQA2gCi4hhgz3b9gd8WhizP' },
  },
  Growth: {
    monthly: { amount: 109_990, price: 'price_1UQA2dCi4hhgz3b99pwkc49c' },
    annual: { amount: 1_187_892, price: 'price_1UQA2cCi4hhgz3b9uYkmSe7Z' },
    setup: { amount: 138_990, price: 'price_1UQA2hCi4hhgz3b9V1bWvLDS' },
  },
  Scale: {
    monthly: { amount: 147_990, price: 'price_1UQA2eCi4hhgz3b9JMgEeHYE' },
    annual: { amount: 1_598_292, price: 'price_1UQA2fCi4hhgz3b9lf203Ifv' },
    setup: { amount: 184_990, price: 'price_1UQA2iCi4hhgz3b9gdOU3bPg' },
  },
} as const;

const addons = {
  'landing-page': { label: 'Landing page de conversão', detail: 'Cobrança única', amount: 88_990, price: 'price_1UQA2jCi4hhgz3b9aOqzDWBZ', recurring: false },
  traffic: { label: 'Gestão de tráfego pago', detail: 'Primeiros 3 meses antecipados', amount: 296_970, price: 'price_1UQA7HCi4hhgz3b9NkKjYEUb', renewalPrice: 'price_1UQA2kCi4hhgz3b9IrEEF42i', recurring: false },
} as const;

const invalid = () => { throw new Error('INVALID_BILLING_SELECTION'); };

export function buildBillingSelection(input: Selection) {
  if (!(input.plan in plans) || !['monthly', 'annual'].includes(input.cycle)) invalid();
  const uniqueAddons = [...new Set(input.addons || [])];
  if (uniqueAddons.some(key => !(key in addons))) invalid();
  const planName = input.plan as BillingPlan;
  const cycle = input.cycle as BillingCycle;
  const plan = plans[planName];
  const subscription = plan[cycle];
  const items: Item[] = [
    { key: `${planName.toLowerCase()}_${cycle}`, label: `Plano ${planName}`, detail: cycle === 'annual' ? 'Assinatura anual antecipada' : 'Assinatura mensal', amountCents: subscription.amount, stripePriceId: subscription.price, recurring: true },
    { key: `${planName.toLowerCase()}_setup`, label: 'Implantação', detail: 'Cobrança única', amountCents: plan.setup.amount, stripePriceId: plan.setup.price, recurring: false },
    ...uniqueAddons.map(key => {
      const addon = addons[key as BillingAddon];
      return { key, label: addon.label, detail: addon.detail, amountCents: addon.amount, stripePriceId: addon.price, recurring: addon.recurring };
    }),
  ];
  return {
    catalogVersion: '2026-10-13',
    plan: planName,
    cycle,
    items,
    amountTotal: items.reduce((total, item) => total + item.amountCents, 0),
    stripePriceIds: items.map(item => item.stripePriceId),
    trafficRenewalPriceId: uniqueAddons.includes('traffic') ? addons.traffic.renewalPrice : null,
    recurring: {
      label: `Plano ${planName}`,
      amountCents: subscription.amount,
      intervalLabel: cycle === 'annual' ? 'por ano' : 'por mês',
    },
  };
}
