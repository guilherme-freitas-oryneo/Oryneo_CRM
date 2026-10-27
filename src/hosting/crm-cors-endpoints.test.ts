import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';

/**
 * Proteção contra regressão de domínio: estas Edge Functions são chamadas
 * pelo navegador do CRM (ou pelos portais públicos de proposta/pagamento).
 * Teste estrutural, NÃO substitui preflight HTTP de produção.
 */
const browserEndpoints=[
 'billing-center',
 'billing-create-order',
 'billing-public',
 'checkout-intake',
 'checkout-intake-noncard-test',
 'company-enrich',
 'delivery-admin',
 'delivery-public',
 'landing-admin',
 'landing-public',
 'offboarding-admin',
 'offboarding-public',
 'proposal-create',
 'proposal-public',
] as const;
const internalHandlers=['mail-api/handler.ts'] as const;

describe('ORYNEO: migração de CORS mantém ambiente antigo e aceita CRM personalizado',()=>{
 for(const endpoint of browserEndpoints){
  it(endpoint,()=>{
   const source=readFileSync('supabase/functions/'+endpoint+'/index.ts','utf8');
   expect(source,endpoint+' deve aceitar o novo domínio').toContain('https://crm.oryneo.com.br');
   expect(source,endpoint+' deve manter origem legada').toContain('https://guilherme-freitas-oryneo.github.io');
  });
 }
 for(const file of internalHandlers){
  it(file,()=>{
   const source=readFileSync('supabase/functions/'+file,'utf8');
   expect(source).toContain('https://crm.oryneo.com.br');
   expect(source).toContain('https://guilherme-freitas-oryneo.github.io');
  });
 }
});
