import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {renderTransactionalEmail} from '../../supabase/functions/_shared/mail/transactional-templates';

const source=readFileSync('supabase/functions/proposal-create/index.ts','utf8');
const fakeToken='q'.repeat(43);
const officialProposalUrl='https://crm.oryneo.com.br/proposta/?token='+fakeToken;

describe('proposta individual — email e link seguro no domínio ORYNEO',()=>{
 it('inclui o mesmo link oficial no HTML e na alternativa em texto do email',()=>{
  const message=renderTransactionalEmail('proposal_sent',{
   firstName:'Cliente de Homologação',
   company:'Empresa de Homologação',
   email:'qa@example.invalid',
   plan:'Start',
   cycle:'monthly',
   orderReference:'PROPOSTA-7',
   amountCents:19990,
   actionUrl:officialProposalUrl,
   whatsappUrl:'https://wa.me/5521974510932',
  });
  expect(message.subject).toContain('proposta ORYNEO');
  expect(message.html).toContain('href="'+officialProposalUrl+'"');
  expect(message.text).toContain('Ver proposta: '+officialProposalUrl);
  expect(message.html).toContain('Ver proposta</a>');
  expect(message.html).not.toContain('javascript:');
 });
 it('não publica CTA inválido quando a URL comercial não é informada',()=>{
  const message=renderTransactionalEmail('proposal_sent',{
   firstName:'Cliente de Homologação',company:'Empresa de Homologação',
   plan:'Start',cycle:'monthly',orderReference:'PROPOSTA-7',
   amountCents:19990,actionUrl:undefined,
  });
  expect(message.html).not.toContain('Ver proposta</a>');
  expect(message.text).not.toContain('Ver proposta: ');
 });
 it('emite o link da mesma versão ao destinatário autorizado sem inventar outra URL',()=>{
  expect(source).toContain("const destination='https://crm.oryneo.com.br/proposta/';");
  expect(source).toContain("const proposalUrl=destination+'?token='+encodeURIComponent(publicToken)");
  expect(source).toContain("template:'proposal_sent',recipient:email,recipientName:name");
  expect(source).toContain('actionUrl:proposalUrl');
  expect(source).toContain("deterministicMailUuid('proposal:'+result.id+':sent')");
 });
 it('não confirma envio se o SMTP falha e oferece o link sem nova emissão',()=>{
  expect(source).toContain('let emailSent=false;');
  expect(source).toContain('emailSent=true;');
  expect(source).toContain("catch(error){console.error('Proposal email delivery needs review'");
  expect(source).toContain('email_sent:emailSent');
  const client=readFileSync('src/billing/ProposalAction.tsx','utf8');
  expect(client).toContain("setEmailState(data.email_sent===true?'sent':'review')");
  expect(client).toContain('A proposta foi criada, mas o envio por e-mail precisa de revisão.');
  expect(client).toContain('Não reemita antes de conferir o registro.');
 });
});
