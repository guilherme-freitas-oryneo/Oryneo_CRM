import { buildBillingQuote } from './catalog.ts';

export type DirectCheckoutInput = {
  request_id: string; payment_token: string; customer_name: string; customer_email: string; customer_phone: string;
  cnpj: string; legacy_company: string;
  plan: string; cycle: string; addons: string[];
  payment_method: 'card'|'boleto'|'pix';
  card_funding: 'credit'|'debit'|null;
};

export type DirectCheckoutDraftInput = Omit<DirectCheckoutInput,'payment_method'|'card_funding'|'legacy_company'> & {
  payment_method: 'card'|'boleto'|'pix'|null;
  card_funding: 'credit'|'debit'|null;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const token = /^[A-Za-z0-9_-]{43}$/;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validBrazilianDdds = new Set(['11','12','13','14','15','16','17','18','19','21','22','24','27','28','31','32','33','34','35','37','38','41','42','43','44','45','46','47','48','49','51','53','54','55','61','62','63','64','65','66','67','68','69','71','73','74','75','77','79','81','82','83','84','85','86','87','88','89','91','92','93','94','95','96','97','98','99']);
const text = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const digits = (value: unknown) => text(value,50).replace(/\D/g,'');

export const normalizeCnpj = (value: unknown) => text(value,40).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,14);

const cnpjDigit=(base:string)=>{
  let sum=0,weight=base.length===12?5:6;
  for(const char of base){sum+=(char.charCodeAt(0)-48)*weight--;if(weight<2)weight=9;}
  const rest=sum%11;
  return rest<2?0:11-rest;
};

export function validCnpj(value:string):boolean{
  const cnpj=normalizeCnpj(value);
  if(!/^[A-Z0-9]{12}\d{2}$/.test(cnpj)||/^([A-Z0-9])\1{11}/.test(cnpj))return false;
  return cnpjDigit(cnpj.slice(0,12))===Number(cnpj[12])&&cnpjDigit(cnpj.slice(0,13))===Number(cnpj[13]);
}

function validCpf(value:string):boolean{
  const cpf=digits(value);
  if(cpf.length!==11||/^(\d)\1+$/.test(cpf))return false;
  const digit=(length:9|10)=>{let sum=0;for(let index=0;index<length;index++)sum+=Number(cpf[index])*(length+1-index);const rest=sum%11;return rest<2?0:11-rest};
  return digit(9)===Number(cpf[9])&&digit(10)===Number(cpf[10]);
}

export function validBrazilianMobile(value:string):boolean{
  let phone=digits(value);
  if(phone.length===13&&phone.startsWith('55'))phone=phone.slice(2);
  const subscriber=phone.slice(3);
  return phone.length===11&&validBrazilianDdds.has(phone.slice(0,2))&&phone[2]==='9'&&!/^(\d)\1+$/.test(phone)&&!/^(\d)\1{7}$/.test(subscriber);
}

export function normalizeBrazilianMobile(value:string):string{
  let phone=digits(value);
  if(phone.length===13&&phone.startsWith('55'))phone=phone.slice(2);
  return validBrazilianMobile(phone)?`+55${phone}`:'';
}

const selection=(raw:Record<string,unknown>)=>({
  plan:text(raw.plan,25),cycle:text(raw.cycle,20),addons:Array.isArray(raw.addons)?raw.addons.map(item=>text(item,30)):[],
});

export function parseDirectCheckoutDraftInput(value:unknown):DirectCheckoutDraftInput{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_DIRECT_CHECKOUT_DRAFT');
  const raw=value as Record<string,unknown>,selected=selection(raw);
  const method=text(raw.payment_method,20);
  const funding=raw.card_funding==null?'':text(raw.card_funding,20);
  if(!uuid.test(text(raw.request_id,36))||!token.test(text(raw.payment_token,60)))throw new Error('INVALID_DIRECT_CHECKOUT_DRAFT');
  if(![raw.customer_name,raw.customer_email,raw.customer_phone,raw.cnpj].some(value=>text(value,254).replace(/\s/g,'').length>=2))throw new Error('INVALID_DIRECT_CHECKOUT_DRAFT');
  if(method&&!['card','boleto','pix'].includes(method))throw new Error('INVALID_DIRECT_CHECKOUT_DRAFT');
  if(funding&&!['credit','debit'].includes(funding))throw new Error('INVALID_DIRECT_CHECKOUT_DRAFT');
  buildBillingQuote(selected);
  return {
    request_id:text(raw.request_id,36),payment_token:text(raw.payment_token,60),
    customer_name:text(raw.customer_name,180),customer_email:text(raw.customer_email,254).toLowerCase(),
    customer_phone:text(raw.customer_phone,40),cnpj:normalizeCnpj(raw.cnpj),
    ...selected,payment_method:(method||null) as DirectCheckoutDraftInput['payment_method'],
    card_funding:method==='card'&&funding?(funding as 'credit'|'debit'):null,
  };
}

export function parseDirectCheckoutInput(value: unknown): DirectCheckoutInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_DIRECT_CHECKOUT');
  const raw = value as Record<string, unknown>,selected=selection(raw);
  const explicitCnpj=raw.cnpj!==undefined;
  const cnpj=normalizeCnpj(explicitCnpj?raw.cnpj:raw.tax_id);
  const legacyTaxId=digits(raw.tax_id);
  const legacyCompany=explicitCnpj?'':text(raw.company,200);
  const normalizedPhone=normalizeBrazilianMobile(text(raw.customer_phone,40));
  const input: DirectCheckoutInput = {
    request_id: text(raw.request_id, 36), payment_token: text(raw.payment_token, 60),
    customer_name: text(raw.customer_name, 180), customer_email: text(raw.customer_email, 254).toLowerCase(),
    customer_phone:normalizedPhone,cnpj,legacy_company:legacyCompany,
    ...selected,
    payment_method: text(raw.payment_method, 20) as DirectCheckoutInput['payment_method'],
    card_funding: raw.card_funding == null ? null : text(raw.card_funding, 20) as DirectCheckoutInput['card_funding'],
  };
  const legacyIdentityOk=!explicitCnpj&&legacyCompany.length>=2&&(validCpf(legacyTaxId)||validCnpj(legacyTaxId));
  const currentIdentityOk=explicitCnpj&&validCnpj(input.cnpj)&&Boolean(input.customer_phone);
  if (!uuid.test(input.request_id) || !token.test(input.payment_token) || input.customer_name.length < 2 || !email.test(input.customer_email) || (!legacyIdentityOk&&!currentIdentityOk)) throw new Error('INVALID_DIRECT_CHECKOUT');
  if (!['card','boleto','pix'].includes(input.payment_method)) throw new Error('INVALID_PAYMENT_METHOD');
  if (input.payment_method === 'card' && (input.card_funding === null || !['credit','debit'].includes(input.card_funding))) throw new Error('INVALID_CARD_FUNDING');
  if (input.payment_method !== 'card') input.card_funding = null;
  buildBillingQuote(selected);
  return input;
}
