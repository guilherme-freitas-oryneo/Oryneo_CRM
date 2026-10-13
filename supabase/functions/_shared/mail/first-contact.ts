import { type ComposeInput } from './actions.ts';
import { renderFirstContactEmail, type AddOn, type BillingCycle, type ContactIntent } from './first-contact-template.ts';

export const FIRST_CONTACT_STAGE_ID = '87f1e31e-3912-40b0-9284-c6805c84dafe';
export const FIRST_CONTACT_LOGO_URL = 'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/oryneo-wordmark-mono.png';

export type FirstContactDeal = {
  id: string;
  data: Record<string, unknown>;
};

export type FirstContactMailbox = {
  id: string;
  address: string;
  active: boolean;
};

export type FirstContactRequest = {
  dealId: string;
  mailboxId: string;
  idempotencyKey: string;
  resend?: boolean;
};

export type FirstContactResult = {
  internetMessageId: string;
  alreadyAccepted: boolean;
  sentAt: string;
};

export type FirstContactActionDependencies = {
  loadDeal(dealId: string): Promise<FirstContactDeal | null>;
  loadMailbox(mailboxId: string): Promise<FirstContactMailbox | null>;
  send(userId: string, input: ComposeInput): Promise<{ internetMessageId: string; alreadyAccepted: boolean }>;
  record(input: {
    dealId: string;
    idempotencyKey: string;
    internetMessageId: string;
    actorId: string;
  }): Promise<{ sentAt: string; alreadyRecorded: boolean }>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const PLANS = new Set(['Start', 'Growth', 'Scale']);
const CYCLES = new Set<BillingCycle>(['monthly', 'annual']);
const ADD_ONS = new Set<AddOn>(['landing-page', 'traffic']);

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function commercial(data: Record<string, unknown>): { plan: 'Start' | 'Growth' | 'Scale'; cycle: BillingCycle; addOns: AddOn[] } {
  const quote = object(data.quote);
  const plan = text(quote.plan);
  const cycle = text(quote.cycle) as BillingCycle;
  if (!PLANS.has(plan) || !CYCLES.has(cycle)) throw new Error('FIRST_CONTACT_INCOMPLETE');
  const addOns = Array.isArray(quote.addons)
    ? [...new Set(quote.addons.map((item) => text(object(item).key)).filter((item): item is AddOn => ADD_ONS.has(item as AddOn)))]
    : [];
  return { plan: plan as 'Start' | 'Growth' | 'Scale', cycle, addOns };
}

function existingKey(data: Record<string, unknown>): string {
  return text(object(data.first_contact).idempotency_key).toLowerCase();
}

export async function sendFirstContact(
  dependencies: FirstContactActionDependencies,
  userId: string,
  request: FirstContactRequest,
): Promise<FirstContactResult> {
  if (!UUID.test(request.dealId) || !UUID.test(request.mailboxId) || !UUID.test(request.idempotencyKey) || typeof request.resend !== 'undefined' && typeof request.resend !== 'boolean') {
    throw new Error('INVALID_MESSAGE');
  }

  const [deal, mailbox] = await Promise.all([
    dependencies.loadDeal(request.dealId),
    dependencies.loadMailbox(request.mailboxId),
  ]);
  if (!deal) throw new Error('NOT_FOUND');
  if (!mailbox?.active || mailbox.id !== request.mailboxId) throw new Error('FIRST_CONTACT_MAILBOX');

  const data = deal.data;
  if (text(data.stage_id) !== FIRST_CONTACT_STAGE_ID) throw new Error('FIRST_CONTACT_STAGE');
  const currentKey = existingKey(data);
  if (currentKey && currentKey !== request.idempotencyKey.toLowerCase() && request.resend !== true) {
    throw new Error('FIRST_CONTACT_ALREADY_SENT');
  }
  if (!currentKey && request.resend === true) throw new Error('FIRST_CONTACT_RESEND');

  const recipient = text(data.email).toLowerCase();
  if (!EMAIL.test(recipient) || /[\r\n\0]/.test(recipient)) throw new Error('FIRST_CONTACT_INVALID_EMAIL');
  const contact = text(data.contact);
  const company = text(data.company);
  if (!contact || !company) throw new Error('FIRST_CONTACT_INCOMPLETE');
  const selection = commercial(data);
  const submission = object(data.form_submission);
  const intent: ContactIntent = submission.intent === 'contract' ? 'contract' : 'conversation';
  const rendered = renderFirstContactEmail({
    intent,
    firstName: contact.split(/\s+/)[0],
    company,
    ...selection,
    goals: strings(submission.goals),
    primaryGoal: text(submission.primary_goal),
    acquisitionChannels: strings(submission.acquisition_channels),
    primaryAcquisitionChannel: text(submission.primary_acquisition_channel),
    acquisitionChannel: text(submission.acquisition_channel),
    logoUrl: FIRST_CONTACT_LOGO_URL,
  });

  const sent = await dependencies.send(userId, {
    mailboxId: request.mailboxId,
    idempotencyKey: request.idempotencyKey,
    to: [{ name: contact, address: recipient }],
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
  const recorded = await dependencies.record({
    dealId: request.dealId,
    idempotencyKey: request.idempotencyKey,
    internetMessageId: sent.internetMessageId,
    actorId: userId,
  });
  return { ...sent, sentAt: recorded.sentAt };
}
