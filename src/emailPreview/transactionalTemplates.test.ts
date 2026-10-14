import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {renderTransactionalEmail,transactionDefinitions,transactionScenarios} from './transactionalTemplates';

const input={
 firstName:'Marina',company:'Empresa & <Consultoria>',email:'marina@empresa.example',
 newEmail:'novo@empresa.example',plan:'Growth',orderReference:'ORY-TEST-100',
 amountCents:337970,renewalAmountCents:109990,
 supportEmail:'contato@oryneo.com.br',
 actionUrl:'https://example.invalid/oryneo/confirmacao',
};
describe('ORYNEO transactional library',()=>{
 it('tem 12 modelos únicos e organizados por categoria',()=>{
  expect(transactionDefinitions).toHaveLength(12);
  expect(transactionScenarios).toHaveLength(12);
  expect(new Set(transactionDefinitions.map(t=>t.id)).size).toBe(12);
  expect(transactionDefinitions.filter(t=>t.category==='finance')).toHaveLength(7);
  expect(transactionDefinitions.filter(t=>t.category==='auth')).toHaveLength(3);
  expect(transactionDefinitions.filter(t=>t.category==='security')).toHaveLength(2);
 });
 it.each(transactionDefinitions)('$id possui assunto, preheader, fallback de texto e HTML responsivo',def=>{
  const email=renderTransactionalEmail(def.id,input);
  expect(email.subject.length).toBeGreaterThan(10);
  expect(email.preheader.length).toBeGreaterThan(10);
  expect(email.text).toContain('Equipe ORYNEO');
  expect(email.html).toContain('lang="pt-BR"');
  expect(email.html).toContain('max-width:600px');
  expect(email.html).toContain('ORYNEO');
  expect(email.html).toContain('contato@oryneo.com.br');
  expect(email.html).not.toContain('Empresa & <Consultoria>');
  expect(email.html).not.toContain('javascript:');
 });

 it('renderiza wordmark oficial comprovadamente idêntico ao Brand Kit no GitHub Pages',()=>{
  for(const def of transactionDefinitions){
   const email=renderTransactionalEmail(def.id,input);
   expect(email.html).toContain('<img src="https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/oryneo-wordmark-mono-reverse.png"');
   expect(email.html).toContain('alt="ORYNEO"');
   expect(email.html).toContain('background:#0F1115');
   expect(email.html).toContain('background:#F8F7F4');
   expect(email.html).not.toContain('>ORYNEO<span');
  }
 });
 it('não inventa links ou tokens de segurança quando a URL não foi fornecida',()=>{
  const {html,text}=renderTransactionalEmail('confirm_email',{...input,actionUrl:undefined});
  expect(html).not.toContain('<a href=""');
  expect(html).not.toContain('Confirmar meu e-mail</a>');
  expect(text).not.toMatch(/https?:\/\/\S*confirmacao/);
 });
 it('bloqueia links javascript e strings de atributo inseguras',()=>{
  for(const actionUrl of ['javascript:alert(1)','https://example.com/" onmouseover="alert(1)','data:text/html,a']){
   const email=renderTransactionalEmail('reset_password',{...input,actionUrl});
   expect(email.html).not.toContain('Criar nova senha</a>');
   expect(email.html).not.toContain('onmouseover=');
  }
 });
 it('escapa textos maliciosos e mantém URLs HTTPS válidas',()=>{
  const email=renderTransactionalEmail('payment_failed',{
   ...input,firstName:'<img src=x onerror=alert(1)>',
   company:'<script>alert(1)</script>',
  });
  expect(email.html).not.toContain('<script>');
  expect(email.html).not.toContain('<img src=x');
  expect(email.html).toContain('&lt;script&gt;');
  expect(email.html).toContain('example.invalid');
 });
 it('não apresenta valores monetários inventados sem dados da fatura',()=>{
  const e=renderTransactionalEmail('subscription_canceled',{...input,amountCents:undefined});
  expect(e.text).not.toContain('Valor reembolsado:');
 });
});
describe('Supabase Auth Go templates',()=>{
 it.each(['confirmation','recovery','invite'])('%s usa link nativo e remetente único previsto',type=>{
  const html=readFileSync(new URL('../../supabase/templates/'+type+'.html',import.meta.url),'utf8');
  expect(html).toContain('{{ .ConfirmationURL }}');
  expect(html).toContain('contato@oryneo.com.br');
  expect(html).not.toContain('sk_test_');
  expect(html).not.toContain('password=');
  expect(html).toContain('ORYNEO');
  expect(html).toContain('oryneo-wordmark-mono-reverse.png');
  expect(html).toContain('background:#0F1115');
  expect(html).not.toContain('>ORYNEO<span');
 });
});
