import assert from 'node:assert/strict';
import { renderFirstContactEmail } from '../_shared/mail/first-contact-template.ts';

Deno.test('renderizador canônico funciona no runtime da Edge Function', () => {
  const email = renderFirstContactEmail({
    intent: 'conversation',
    firstName: 'Marina',
    company: 'Acme',
    plan: 'Growth',
    cycle: 'annual',
    addOns: ['landing-page', 'traffic'],
    goals: ['Organizar contatos e negociações no CRM', 'Acompanhar resultados e gestão'],
    primaryGoal: 'Organizar contatos e negociações no CRM',
    acquisitionChannels: ['Indicações e parcerias', 'Google'],
    primaryAcquisitionChannel: 'Indicações e parcerias',
    logoUrl: 'https://oryneo.com.br/assets/oryneo-wordmark-mono-reverse.png',
  });

  assert.equal(email.subject, 'Sua solicitação na ORYNEO');
  assert.match(email.text, /Também entra no contexto Google/);
  assert.match(email.html, /https:\/\/oryneo\.com\.br\/assets\/oryneo-wordmark-mono-reverse\.png/);
  assert.doesNotMatch(email.html, /fonts\.googleapis|@font-face|oryneo-y/iu);
});
