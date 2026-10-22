import { buildBillingQuote, type BillingAddon, type BillingCycle, type BillingPlan } from './catalog.ts';

export type RenewalService = 'plan' | 'traffic';
export type RenewalSelection = Readonly<{ plan: BillingPlan; cycle: BillingCycle; addons: readonly BillingAddon[] }>;

function addUtcMonthsClamped(startedAt: string, months: number): string | null {
  const date = new Date(startedAt);
  if (!Number.isFinite(date.getTime())) return null;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

export function nextPlanChargeAt(startedAt: string | null | undefined, cycle: BillingCycle): string | null {
  if (!startedAt) return null;
  return addUtcMonthsClamped(startedAt, cycle === 'annual' ? 12 : 1);
}

export function nextTrafficChargeAt(startedAt: string | null | undefined): string | null {
  if (!startedAt) return null;
  return addUtcMonthsClamped(startedAt, 3);
}

export function resolveRenewalCharge(selection: RenewalSelection, service: RenewalService): {
  kind: 'plan_monthly' | 'plan_annual' | 'traffic_quarterly';
  amountCents: number;
  label: string;
} {
  const quote = buildBillingQuote({ plan: selection.plan, cycle: selection.cycle, addons: [...selection.addons] });
  if (service === 'plan') {
    const recurring = quote.items.find((item) => item.recurring);
    if (!recurring) throw new Error('PLAN_RENEWAL_NOT_CONTRACTED');
    return {
      kind: selection.cycle === 'annual' ? 'plan_annual' : 'plan_monthly',
      amountCents: recurring.amountCents,
      label: `Plano ${selection.plan} · renovação ${selection.cycle === 'annual' ? 'anual' : 'mensal'}`,
    };
  }
  if (!selection.addons.includes('traffic')) throw new Error('TRAFFIC_NOT_CONTRACTED');
  const traffic = quote.items.find((item) => item.key === 'traffic');
  if (!traffic) throw new Error('TRAFFIC_NOT_CONTRACTED');
  return { kind: 'traffic_quarterly', amountCents: traffic.amountCents, label: 'Gestão de tráfego pago · renovação trimestral' };
}

