export const ACQUISITION_CHANNELS = [
  'Indicações e parcerias',
  'Instagram e Facebook',
  'Google',
  'Prospecção ativa',
  'Portais e marketplaces',
  'Loja física e eventos',
  'Ainda não temos um canal previsível',
  'Outro canal',
] as const;

export const GOALS = [
  'Atrair contatos com páginas e anúncios',
  'Organizar contatos e negociações no CRM',
  'Organizar retornos pelo WhatsApp',
  'Acompanhar resultados e gestão',
] as const;

export const TEAM_SIZES = [
  'Somente eu',
  '2 a 5 pessoas',
  '6 a 10 pessoas',
  '11 a 20 pessoas',
  'Mais de 20 pessoas',
] as const;

const catalog = {
  Start: { monthly: 74_990, setup: 98_990, users: 5 },
  Growth: { monthly: 109_990, setup: 138_990, users: 10 },
  Scale: { monthly: 147_990, setup: 184_990, users: 20 },
} as const;

const additions = {
  'landing-page': { label: 'Landing page de conversão', amount: 88_990, billing: 'one_time' },
  traffic: { label: 'Gestão de tráfego pago', amount: 98_990, billing: 'monthly', minimumMonths: 3 },
} as const;

type Plan = keyof typeof catalog;
type AddOn = keyof typeof additions;
type Intent = 'conversation' | 'contract';
type Cycle = 'monthly' | 'annual';

export type IntakeQuote = {
  plan: Plan;
  cycle: Cycle;
  monthly_cents: number;
  period_cents: number;
  setup_cents: number;
  first_charge_cents: number;
  users: number;
  catalog_version: '2026-10-11';
  addons: Array<{ key: AddOn; label: string; billing: string; amount_cents: number; upfront_cents: number }>;
};

export type IntakeAttribution = Partial<Record<
  'utm_source' | 'utm_medium' | 'utm_campaign' | 'utm_content' | 'utm_term' | 'referrer' | 'entry_url',
  string
>>;

export type NormalizedIntakePayload = {
  requestId: string;
  contact: string;
  phone: string;
  email: string;
  company: string;
  cnpj: string;
  summary: string;
  quote: IntakeQuote | null;
  formSubmission: {
    intent: Intent;
    goals: string[];
    primary_goal: string;
    team_size: string;
    acquisition_channel: string;
    acquisition_channels: string[];
    primary_acquisition_channel: string;
    attribution: IntakeAttribution;
  };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNPREDICTABLE = 'Ainda não temos um canal previsível';

export function clean(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function digits(value: unknown): string {
  return clean(value, 50).replace(/\D/g, '');
}

export function normalizedCnpj(value: unknown): string {
  return clean(value, 50).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function uniqueStrings(value: unknown, maxInput: number, maxLength: number, errorCode: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxInput || value.some((item) => typeof item !== 'string')) {
    throw new Error(errorCode);
  }
  return [...new Set(value.map((item) => clean(item, maxLength)).filter(Boolean))];
}

function acquisition(input: Record<string, unknown>): { channels: string[]; primary: string; modern: boolean } {
  const modern = Array.isArray(input.acquisition_channels);
  const channels = modern
    ? uniqueStrings(input.acquisition_channels, 8, 120, 'INVALID_ACQUISITION')
    : [clean(input.acquisition_channel, 120)].filter(Boolean);
  if (!channels.length || channels.length > 8 || channels.some((channel) => !ACQUISITION_CHANNELS.includes(channel as typeof ACQUISITION_CHANNELS[number]))) {
    throw new Error('INVALID_ACQUISITION');
  }
  if (channels.includes(UNPREDICTABLE) && channels.length !== 1) throw new Error('INVALID_ACQUISITION');
  const suppliedPrimary = clean(input.primary_acquisition_channel, 120);
  const primary = channels.length === 1 ? channels[0] : suppliedPrimary;
  if (!primary || !channels.includes(primary)) throw new Error('INVALID_ACQUISITION');
  return { channels, primary, modern };
}

function goals(input: Record<string, unknown>, modern: boolean): { selected: string[]; primary: string } {
  const selected = uniqueStrings(input.goals, 12, 120, 'INVALID_ACQUISITION');
  if (selected.some((goal) => !GOALS.includes(goal as typeof GOALS[number]))) throw new Error('INVALID_ACQUISITION');
  const suppliedPrimary = clean(input.primary_goal, 120);
  const primary = selected.length === 1 ? selected[0] : suppliedPrimary || (!modern ? selected[0] : '');
  if (!primary || !selected.includes(primary)) throw new Error('INVALID_ACQUISITION');
  return { selected, primary };
}

function attribution(value: unknown): IntakeAttribution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const output: IntakeAttribution = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer', 'entry_url'] as const) {
    const max = key === 'referrer' || key === 'entry_url' ? 500 : 160;
    const normalized = (typeof source[key] === 'string' ? source[key] : '')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .trim()
      .slice(0, max);
    if (normalized) output[key] = normalized;
  }
  return output;
}

export function quoteSelection(input: Record<string, unknown>): IntakeQuote | null {
  const plan = clean(input.plan, 25);
  const cycle = clean(input.cycle, 20) || 'monthly';
  const services = input.services ?? [];
  if (!Array.isArray(services) || services.length > 2 || services.some((item) => typeof item !== 'string')) throw new Error('INVALID_COMMERCIAL');
  const serviceIds = [...new Set(services)];
  if (serviceIds.some((item) => !Object.prototype.hasOwnProperty.call(additions, item))) throw new Error('INVALID_COMMERCIAL');
  if (!plan) {
    if (serviceIds.length) throw new Error('INVALID_COMMERCIAL');
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(catalog, plan) || !['monthly', 'annual'].includes(cycle)) throw new Error('INVALID_COMMERCIAL');
  const selected = catalog[plan as Plan];
  const period = cycle === 'annual' ? Math.round(selected.monthly * 12 * 0.9) : selected.monthly;
  const addons = serviceIds.map((value) => {
    const key = value as AddOn;
    const item = additions[key];
    return {
      key,
      label: item.label,
      billing: item.billing,
      amount_cents: item.amount,
      upfront_cents: item.amount * ('minimumMonths' in item ? item.minimumMonths : 1),
    };
  });
  return {
    plan: plan as Plan,
    cycle: cycle as Cycle,
    monthly_cents: selected.monthly,
    period_cents: period,
    setup_cents: selected.setup,
    first_charge_cents: period + selected.setup + addons.reduce((sum, item) => sum + item.upfront_cents, 0),
    users: selected.users,
    catalog_version: '2026-10-11',
    addons,
  };
}

export function normalizeIntakePayload(input: Record<string, unknown>): NormalizedIntakePayload {
  const requestId = clean(input.request_id, 40);
  const contact = clean(input.contact, 160);
  const phone = clean(input.phone, 40);
  const email = clean(input.email, 254).toLowerCase();
  const phoneDigits = digits(phone);
  if (!UUID.test(requestId) || input.consent !== true || contact.length < 2 || !EMAIL.test(email) || phoneDigits.length < 10 || phoneDigits.length > 13) {
    throw new Error('INVALID_CONTACT');
  }

  const intent = clean(input.intent, 30) || 'conversation';
  const cnpj = normalizedCnpj(input.cnpj);
  if (!['conversation', 'contract'].includes(intent) || (cnpj && cnpj.length !== 14) || (intent === 'contract' && cnpj.length !== 14)) {
    throw new Error('INVALID_COMMERCIAL');
  }
  const channelSelection = acquisition(input);
  const goalSelection = goals(input, channelSelection.modern);
  const teamSize = clean(input.team_size, 70);
  if (!TEAM_SIZES.includes(teamSize as typeof TEAM_SIZES[number])) throw new Error('INVALID_ACQUISITION');

  return {
    requestId,
    contact,
    phone,
    email,
    company: clean(input.company, 160),
    cnpj,
    summary: clean(input.summary, 11_000),
    quote: quoteSelection(input),
    formSubmission: {
      intent: intent as Intent,
      goals: goalSelection.selected,
      primary_goal: goalSelection.primary,
      team_size: teamSize,
      acquisition_channel: channelSelection.primary,
      acquisition_channels: channelSelection.channels,
      primary_acquisition_channel: channelSelection.primary,
      attribution: attribution(input.attribution),
    },
  };
}
