import assert from 'node:assert/strict';
import { normalizeIntakePayload, quoteSelection } from '../_shared/intake/contract.ts';

const requestId = '11111111-1111-4111-8111-111111111111';
const base = {
  request_id: requestId,
  contact: '  Marina Costa  ',
  phone: '(11) 99999-0000',
  email: ' MARINA@EXEMPLO.COM ',
  consent: true,
  company: 'Acme',
  cnpj: '',
  summary: 'Quero organizar a operação.',
  plan: 'Growth',
  cycle: 'annual',
  services: ['landing-page', 'traffic'],
  intent: 'conversation',
  team_size: '2 a 5 pessoas',
  goals: ['Organizar contatos e negociações no CRM'],
};

Deno.test('normaliza o payload legado sem quebrar o contrato atual', () => {
  const result = normalizeIntakePayload({ ...base, acquisition_channel: 'Indicações e parcerias' });
  assert.equal(result.requestId, requestId);
  assert.equal(result.contact, 'Marina Costa');
  assert.equal(result.email, 'marina@exemplo.com');
  assert.equal(result.formSubmission.acquisition_channel, 'Indicações e parcerias');
  assert.deepEqual(result.formSubmission.acquisition_channels, ['Indicações e parcerias']);
  assert.equal(result.formSubmission.primary_acquisition_channel, 'Indicações e parcerias');
  assert.equal(result.formSubmission.primary_goal, 'Organizar contatos e negociações no CRM');
  assert.equal(result.quote?.first_charge_cents, 1_712_842);
});

Deno.test('preserva canais múltiplos e exige que o principal esteja na seleção', () => {
  const result = normalizeIntakePayload({
    ...base,
    acquisition_channels: ['Indicações e parcerias', 'Instagram e Facebook', 'Indicações e parcerias'],
    primary_acquisition_channel: 'Indicações e parcerias',
  });
  assert.deepEqual(result.formSubmission.acquisition_channels, ['Indicações e parcerias', 'Instagram e Facebook']);
  assert.equal(result.formSubmission.acquisition_channel, 'Indicações e parcerias');
  assert.throws(() => normalizeIntakePayload({
    ...base,
    acquisition_channels: ['Indicações e parcerias', 'Google'],
    primary_acquisition_channel: 'Prospecção ativa',
  }), /INVALID_ACQUISITION/);
});

Deno.test('torna o canal sem previsibilidade exclusivo', () => {
  assert.throws(() => normalizeIntakePayload({
    ...base,
    acquisition_channels: ['Ainda não temos um canal previsível', 'Google'],
    primary_acquisition_channel: 'Google',
  }), /INVALID_ACQUISITION/);
});

Deno.test('recusa mais de oito canais e opções fora do catálogo', () => {
  assert.throws(() => normalizeIntakePayload({
    ...base,
    acquisition_channels: Array.from({ length: 9 }, (_, index) => `Canal ${index}`),
    primary_acquisition_channel: 'Canal 0',
  }), /INVALID_ACQUISITION/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channels: ['TikTok'] }), /INVALID_ACQUISITION/);
});

Deno.test('valida objetivos e a prioridade principal sem quebrar payload legado', () => {
  const legacy = normalizeIntakePayload({
    ...base,
    acquisition_channel: 'Google',
    goals: ['Organizar contatos e negociações no CRM', 'Acompanhar resultados e gestão'],
  });
  assert.equal(legacy.formSubmission.primary_goal, 'Organizar contatos e negociações no CRM');
  assert.throws(() => normalizeIntakePayload({
    ...base,
    acquisition_channels: ['Google'],
    goals: ['Organizar contatos e negociações no CRM', 'Acompanhar resultados e gestão'],
  }), /INVALID_ACQUISITION/);
  assert.throws(() => normalizeIntakePayload({
    ...base,
    acquisition_channels: ['Google'],
    goals: Array.from({ length: 13 }, () => 'Organizar contatos e negociações no CRM'),
    primary_goal: 'Organizar contatos e negociações no CRM',
  }), /INVALID_ACQUISITION/);
});

Deno.test('sanitiza e limita atribuição', () => {
  const result = normalizeIntakePayload({
    ...base,
    acquisition_channel: 'Google',
    attribution: {
      utm_source: `  google\n${'x'.repeat(300)}`,
      utm_medium: ' cpc ',
      entry_url: `https://example.com/${'x'.repeat(800)}`,
      referrer: 'https://google.com/',
      ignored: 'não persistir',
    },
  });
  assert.equal(result.formSubmission.attribution.utm_source!.includes('\n'), false);
  assert.equal(result.formSubmission.attribution.utm_source!.length, 160);
  assert.equal(result.formSubmission.attribution.utm_medium, 'cpc');
  assert.equal(result.formSubmission.attribution.entry_url!.length, 500);
  assert.equal('ignored' in result.formSubmission.attribution, false);
});

Deno.test('recusa nome, e-mail e WhatsApp inválidos também em chamadas diretas', () => {
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', email: '' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', email: 'teste@gmayg.com' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', email: 'teste@gemau.com' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', email: 'teste@gemau' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', email: 'teste@gmaul.com' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', email: 'teste@gamul.com.br' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', email: 'teste@gamul.con.by' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', email: 'teste@yaho.com.br' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', email: 'teste@gmail.con' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', email: 'teste@gmail.com.br' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', email: 'teste@empresa..com' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', phone: '123' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', phone: '(00) 99999-9999' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', phone: '(11) 88888-8888' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', phone: '(21) 90000-0000' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', phone: '(21) 91111-1111' }), /INVALID_CONTACT/);
  assert.doesNotThrow(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', phone: '(21) 98765-4321', email: 'contato@oryneo.com.br' }));
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', contact: '1' }), /INVALID_CONTACT/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', consent: false }), /INVALID_CONTACT/);
});

Deno.test('aceita contratação sem CNPJ e exige empresa identificável', () => {
  const result = normalizeIntakePayload({ ...base, acquisition_channel: 'Google', intent: 'contract' });
  assert.equal(result.formSubmission.intent, 'contract');
  assert.equal(result.cnpj, '');
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', company: ' ' }), /INVALID_COMMERCIAL/);
  assert.throws(() => normalizeIntakePayload({ ...base, acquisition_channel: 'Google', company: '--' }), /INVALID_COMMERCIAL/);
});

Deno.test('recalcula a cotação e ignora preços enviados pelo navegador', () => {
  const quote = quoteSelection({ ...base, price: 1, total: 1, value_cents: 1 });
  assert.equal(quote?.monthly_cents, 109_990);
  assert.equal(quote?.period_cents, 1_187_892);
  assert.equal(quote?.first_charge_cents, 1_712_842);
  assert.throws(() => quoteSelection({ ...base, plan: 'Enterprise' }), /INVALID_COMMERCIAL/);
  assert.throws(() => quoteSelection({ ...base, services: ['traffic', 'root-access'] }), /INVALID_COMMERCIAL/);
});
