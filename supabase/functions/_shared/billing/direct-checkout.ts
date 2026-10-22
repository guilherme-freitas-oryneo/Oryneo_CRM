import { buildBillingQuote } from './catalog.ts';

export type DirectCheckoutInput = {
  request_id: string; payment_token: string; customer_name: string; customer_email: string; company: string; tax_id: string;
  plan: string; cycle: string; addons: string[];
  payment_method: 'card'|'boleto'|'pix';
  card_funding: 'credit'|'debit';
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const token = /^[A-Za-z0-9_-]{43}$/;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validTaxId = (value: string) => { const id=value.replace(/\D/g,''); if (![11,14].includes(id.length)||/^([0-9])\1+$/.test(id)) return false; const calc=(base:string)=>{let sum=0,weight=base.length===9?10:base.length===10?11:base.length-7;for(const c of base){sum+=Number(c)*weight--;if(weight<2)weight=9;}const rest=sum%11;return rest<2?0:11-rest}; return id.length===11?calc(id.slice(0,9))===+id[9]&&calc(id.slice(0,10))===+id[10]:calc(id.slice(0,12))===+id[12]&&calc(id.slice(0,13))===+id[13]; };

export function parseDirectCheckoutInput(value: unknown): DirectCheckoutInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_DIRECT_CHECKOUT');
  const raw = value as Record<string, unknown>;
  const input: DirectCheckoutInput = {
    request_id: text(raw.request_id, 36), payment_token: text(raw.payment_token, 60),
    customer_name: text(raw.customer_name, 180), customer_email: text(raw.customer_email, 254).toLowerCase(), company: text(raw.company, 200), tax_id: text(raw.tax_id, 20).replace(/\D/g,''),
    plan: text(raw.plan, 25), cycle: text(raw.cycle, 20), addons: Array.isArray(raw.addons) ? raw.addons.map(item => text(item, 30)) : [],
    payment_method: (raw.payment_method === undefined ? 'card' : text(raw.payment_method, 20)) as DirectCheckoutInput['payment_method'],
    card_funding: (raw.card_funding === undefined ? 'credit' : text(raw.card_funding, 20)) as DirectCheckoutInput['card_funding'],
  };
  if (!uuid.test(input.request_id) || !token.test(input.payment_token) || input.customer_name.length < 2 || input.company.length < 2 || !email.test(input.customer_email) || !validTaxId(input.tax_id)) throw new Error('INVALID_DIRECT_CHECKOUT');
  if (!['card','boleto','pix'].includes(input.payment_method)) throw new Error('INVALID_PAYMENT_METHOD');
  if (!['credit','debit'].includes(input.card_funding)) throw new Error('INVALID_CARD_FUNDING');
  buildBillingQuote({ plan: input.plan, cycle: input.cycle, addons: input.addons });
  return input;
}
