import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  FIRST_CONTACT_STAGE_ID,
  sendFirstContact,
  type FirstContactActionDependencies,
  type FirstContactDeal,
} from '../_shared/mail/first-contact.ts';
import { createMailApiHandler } from '../mail-api/handler.ts';

const DEAL_ID = '11111111-1111-4111-8111-111111111111';
const MAILBOX_ID = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';
const RESEND_KEY = '44444444-4444-4444-8444-444444444444';

function deal(overrides: Record<string, unknown> = {}): FirstContactDeal {
  return {
    id: DEAL_ID,
    data: {
      stage_id: FIRST_CONTACT_STAGE_ID,
      contact: 'Marina Souza',
      company: 'Aurora Clínica',
      email: 'marina@aurora.example',
      quote: {
        plan: 'Growth', cycle: 'annual',
        addons: [{ key: 'landing-page' }, { key: 'traffic' }],
      },
      form_submission: {
        intent: 'contract',
        goals: ['Organizar contatos e negociações no CRM', 'Acompanhar resultados e gestão'],
        primary_goal: 'Acompanhar resultados e gestão',
        acquisition_channels: ['Indicações e parcerias', 'Google'],
        primary_acquisition_channel: 'Indicações e parcerias',
      },
      ...overrides,
    },
  };
}

function dependencies(currentDeal = deal()) {
  const sent: Array<Record<string, unknown>> = [];
  const recorded: Array<Record<string, unknown>> = [];
  const value: FirstContactActionDependencies = {
    loadDeal: () => Promise.resolve(currentDeal),
    loadMailbox: () => Promise.resolve({ id: MAILBOX_ID, address: 'contato@oryneo.com.br', active: true }),
    send: (_userId, input) => {
      sent.push(input as unknown as Record<string, unknown>);
      return Promise.resolve({ internetMessageId: `<${KEY}@oryneo.com.br>`, alreadyAccepted: false });
    },
    record: (input) => {
      recorded.push(input as unknown as Record<string, unknown>);
      return Promise.resolve({ sentAt: '2026-10-13T12:00:00.000Z', alreadyRecorded: false });
    },
  };
  return { value, sent, recorded };
}

Deno.test('primeiro contato deriva destinatário e conteúdo do lead no servidor', async () => {
  const fake = dependencies();
  const result = await sendFirstContact(fake.value, 'user-1', {
    dealId: DEAL_ID, mailboxId: MAILBOX_ID, idempotencyKey: KEY,
  });
  assertEquals(result, {
    internetMessageId: `<${KEY}@oryneo.com.br>`, alreadyAccepted: false, sentAt: '2026-10-13T12:00:00.000Z',
  });
  assertEquals(fake.sent.length, 1);
  assertEquals(fake.sent[0].to, [{ name: 'Marina Souza', address: 'marina@aurora.example' }]);
  assertEquals(fake.sent[0].mailboxId, MAILBOX_ID);
  assertEquals(fake.sent[0].idempotencyKey, KEY);
  assert(String(fake.sent[0].html).includes('https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/oryneo-wordmark-mono.png'));
  assert(String(fake.sent[0].html).includes('Como indicações e parcerias'));
  assert(!String(fake.sent[0].html).includes('destinatario-injetado@example.com'));
  assertEquals(fake.recorded[0], {
    dealId: DEAL_ID, idempotencyKey: KEY, internetMessageId: `<${KEY}@oryneo.com.br>`, actorId: 'user-1',
  });
});

Deno.test('primeiro contato bloqueia etapa incorreta antes do transporte', async () => {
  const fake = dependencies(deal({ stage_id: '55555555-5555-4555-8555-555555555555' }));
  await assertRejects(
    () => sendFirstContact(fake.value, 'user-1', { dealId: DEAL_ID, mailboxId: MAILBOX_ID, idempotencyKey: KEY }),
    Error, 'FIRST_CONTACT_STAGE',
  );
  assertEquals(fake.sent.length, 0);
});

Deno.test('primeiro contato bloqueia e-mail inválido antes do transporte', async () => {
  const fake = dependencies(deal({ email: 'marina\nBcc:intruso@example.com' }));
  await assertRejects(
    () => sendFirstContact(fake.value, 'user-1', { dealId: DEAL_ID, mailboxId: MAILBOX_ID, idempotencyKey: KEY }),
    Error, 'FIRST_CONTACT_INVALID_EMAIL',
  );
  assertEquals(fake.sent.length, 0);
});

Deno.test('primeiro contato não registra quando o SMTP falha', async () => {
  const fake = dependencies();
  fake.value.send = () => Promise.reject(new Error('MAIL_SEND'));
  await assertRejects(
    () => sendFirstContact(fake.value, 'user-1', { dealId: DEAL_ID, mailboxId: MAILBOX_ID, idempotencyKey: KEY }),
    Error, 'MAIL_SEND',
  );
  assertEquals(fake.recorded.length, 0);
});

Deno.test('retry após aceitação repara o registro com a mesma chave', async () => {
  const fake = dependencies();
  fake.value.send = (_userId, input) => {
    fake.sent.push(input as unknown as Record<string, unknown>);
    return Promise.resolve({ internetMessageId: `<${KEY}@oryneo.com.br>`, alreadyAccepted: true });
  };
  const result = await sendFirstContact(fake.value, 'user-1', {
    dealId: DEAL_ID, mailboxId: MAILBOX_ID, idempotencyKey: KEY,
  });
  assertEquals(result.alreadyAccepted, true);
  assertEquals(fake.recorded.length, 1);
});

Deno.test('novo envio exige reenvio explícito e nova confirmação', async () => {
  const contacted = deal({ first_contact: { sent_at: '2026-10-13T10:00:00Z', internet_message_id: '<old@oryneo.com.br>', idempotency_key: KEY } });
  const blocked = dependencies(contacted);
  await assertRejects(
    () => sendFirstContact(blocked.value, 'user-1', { dealId: DEAL_ID, mailboxId: MAILBOX_ID, idempotencyKey: RESEND_KEY }),
    Error, 'FIRST_CONTACT_ALREADY_SENT',
  );
  assertEquals(blocked.sent.length, 0);

  const allowed = dependencies(contacted);
  await sendFirstContact(allowed.value, 'user-1', {
    dealId: DEAL_ID, mailboxId: MAILBOX_ID, idempotencyKey: RESEND_KEY, resend: true,
  });
  assertEquals(allowed.sent.length, 1);
});

Deno.test('caixa inativa e dados comerciais incompletos são bloqueados no servidor', async () => {
  const inactive = dependencies();
  inactive.value.loadMailbox = () => Promise.resolve({ id: MAILBOX_ID, address: 'contato@oryneo.com.br', active: false });
  await assertRejects(
    () => sendFirstContact(inactive.value, 'user-1', { dealId: DEAL_ID, mailboxId: MAILBOX_ID, idempotencyKey: KEY }),
    Error, 'FIRST_CONTACT_MAILBOX',
  );

  const incomplete = dependencies(deal({ quote: null }));
  await assertRejects(
    () => sendFirstContact(incomplete.value, 'user-1', { dealId: DEAL_ID, mailboxId: MAILBOX_ID, idempotencyKey: KEY }),
    Error, 'FIRST_CONTACT_INCOMPLETE',
  );
});

Deno.test('mail-api autoriza a ação autenticada e traduz erros de primeiro contato', async () => {
  let invoked = false;
  const handler = createMailApiHandler({
    authenticate: () => Promise.resolve('user-1'),
    isMember: () => Promise.resolve(true),
    execute: () => {
      invoked = true;
      return Promise.reject(new Error('FIRST_CONTACT_STAGE: detalhe privado'));
    },
  });
  const response = await handler(new Request('https://example.test/mail-api', {
    method: 'POST',
    headers: { authorization: 'Bearer jwt' },
    body: JSON.stringify({ action: 'send-first-contact', dealId: DEAL_ID, mailboxId: MAILBOX_ID, idempotencyKey: KEY }),
  }));
  assertEquals(invoked, true);
  assertEquals(response.status, 409);
  assertEquals(await response.json(), { ok: false, error: 'FIRST_CONTACT_STAGE' });
});
