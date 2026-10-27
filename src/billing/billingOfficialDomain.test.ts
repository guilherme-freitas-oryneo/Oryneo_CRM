import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const source=readFileSync('supabase/functions/billing-create-order/index.ts','utf8');

describe('checkout assistido — migração controlada de domínio',()=>{
 it('retorna links novos e return_url da Stripe no subdomínio HTTPS oficial',()=>{
  expect(source).toContain("const publicBase='https://crm.oryneo.com.br';");
  expect(source).toContain("form.set('return_url',`\${publicBase}/pagar/?token=\${encodeURIComponent(publicToken)}&retorno=1`)");
  expect(source).toContain("return respond({ok:true,reference:ref,url:`\${publicBase}/pagar/?token=\${encodeURIComponent(publicToken)}`})");
  expect(source).not.toMatch(/\${origin}\/Oryneo_CRM\/pagar\//);
 });
 it('preserva CORS legado e novo, e autenticação de quem prepara a cobrança',()=>{
  expect(source).toContain("const origin='https://guilherme-freitas-oryneo.github.io';");
  expect(source).toContain("new Set([origin,'https://crm.oryneo.com.br'])");
  expect(source).toContain('db.auth.getUser(jwt)');
  expect(source).toContain("db.from('crm_members')");
 });
 it('recusa formas não homologadas no checkout assistido',()=>{
  expect(source).toContain("body.payment_method&&body.payment_method!=='card'");
  expect(source).toContain('Esta forma de pagamento ainda não foi homologada');
 });
 it('exige aceite imutável, confere preços e bloqueia pedido duplicado',()=>{
  expect(source).toContain("proposal.status!=='accepted'");
  expect(source).toContain("snapshot.catalog_version!==selection.catalogVersion");
  expect(source).toContain("proposal.contact_email!==String(data.email||'').trim().toLowerCase()");
  expect(source).toContain(".eq('proposal_id',proposal.id).maybeSingle()");
  expect(source).toContain("insertError.code==='23505'");
  expect(source).toContain("'Idempotency-Key':`oryneo-order-\${config.environment}-\${orderId}`");
 });
 it('não altera o ambiente financeiro nem os planos do servidor',()=>{
  expect(source).toContain("const environment='live' as const");
  expect(source).toContain("form.set('mode','subscription')");
  expect(source).toContain("form.set('ui_mode','elements')");
  expect(source).toContain("resolveStripeBillingPrices(config)");
 });
});
