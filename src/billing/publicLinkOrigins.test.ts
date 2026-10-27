import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const file=(path:string)=>readFileSync('supabase/functions/'+path,'utf8');

describe('dominio oficial nas jornadas publicas ORYNEO',()=>{
 it('checkout direto gera link e Stripe return_url na raiz /pagar/',()=>{
  const s=file('checkout-intake/index.ts');
  expect(s).toContain("const publicOrigin='https://crm.oryneo.com.br';");
  expect(s).toContain("form.set('return_url',`\${publicOrigin}/pagar/?token=\${encodeURIComponent(input.payment_token)}&retorno=1`)");
  expect(s).toContain("url:`\${publicOrigin}/pagar/?token=\${encodeURIComponent(input.payment_token)}`");
  expect(s).not.toContain('${publicOrigin}/Oryneo_CRM/pagar/');
 });
 it('troca de pagamento Pix/Boleto/cartao usa subdominio, sem redirecionar para o host antigo',()=>{
  const s=file('billing-public/index.ts');
  expect(s).toContain("const publicOrigin='https://crm.oryneo.com.br';");
  expect(s).not.toContain("https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/pagar/?token=");
  expect(s).not.toContain('${publicOrigin}/Oryneo_CRM/pagar/');
  expect(s).toContain("https://crm.oryneo.com.br/pagar/?token=");
  expect(s).toContain('${publicOrigin}/pagar/');
 });
 it('link de revisao de landing aponta ao subdominio e o token continua protegido',()=>{
  const s=file('landing-admin/index.ts');
  expect(s).toContain("url:'https://crm.oryneo.com.br/revisao-lp/?token='+encodeURIComponent(secret)");
  expect(s).not.toContain("url:'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/revisao-lp/");
 });
});
