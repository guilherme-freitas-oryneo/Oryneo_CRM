import assert from 'node:assert/strict';
import { sendMail, validateCompose, type ComposeInput, type MailSendDependencies } from '../_shared/mail/actions.ts';
import { createMailApiHandler } from '../mail-api/handler.ts';

const compose: ComposeInput = {
  mailboxId: '11111111-1111-4111-8111-111111111111',
  idempotencyKey: '22222222-2222-4222-8222-222222222222',
  to: [{ address: 'cliente@exemplo.com', name: 'Cliente' }],
  cc: [], bcc: [], subject: 'Proposta ORYNEO', text: 'Segue a proposta.', html: '<p>Segue a proposta.</p>', attachments: [],
};

Deno.test('validateCompose recusa injeção e limites de anexos', () => {
  assert.throws(() => validateCompose({ ...compose, subject: 'Oi\r\nBcc: invasor@x.test' }), /INVALID_MESSAGE/);
  assert.throws(() => validateCompose({ ...compose, to: [{ address: 'inválido' }] }), /INVALID_RECIPIENT/);
  assert.throws(() => validateCompose({ ...compose, attachments: [{ filename: 'grande.bin', mimeType: 'application/octet-stream', content: new Uint8Array(15 * 1024 * 1024 + 1) }] }), /ATTACHMENT_TOO_LARGE/);
  const tenMiB = new Uint8Array(10 * 1024 * 1024 + 1);
  assert.throws(() => validateCompose({ ...compose, attachments: [
    { filename: 'a.bin', mimeType: 'application/octet-stream', content: tenMiB },
    { filename: 'b.bin', mimeType: 'application/octet-stream', content: tenMiB },
  ] }), /ATTACHMENTS_TOO_LARGE/);
});

Deno.test('sendMail em retry detecta Message-ID aceito e não envia SMTP novamente', async () => {
  let smtpCalls = 0;
  let completed = false;
  const dependencies: MailSendDependencies = {
    getCredentials: () => Promise.resolve({ address: 'contato@oryneo.com.br', displayName: 'ORYNEO', imapHost: 'imap.hostinger.com', imapPort: 993, smtpHost: 'smtp.hostinger.com', smtpPort: 465, password: 'segredo' }),
    beginOutbox: () => Promise.resolve({ state: 'failed', internetMessageId: '<22222222-2222-4222-8222-222222222222@oryneo.com.br>', acceptedAt: '2026-10-12T19:00:00Z' }),
    findSentMessage: () => Promise.resolve(true),
    smtpSend: () => { smtpCalls += 1; return Promise.resolve(); },
    appendSent: () => Promise.resolve(),
    markAccepted: () => Promise.resolve(),
    markSent: () => { completed = true; return Promise.resolve(); },
    markFailed: () => Promise.resolve(),
  };
  const result = await sendMail(dependencies, 'user-1', compose);
  assert.equal(result.alreadyAccepted, true);
  assert.equal(smtpCalls, 0);
  assert.equal(completed, true);
});

Deno.test('sendMail envia uma vez, registra aceitação e anexa em Enviados', async () => {
  const sequence: string[] = [];
  const dependencies: MailSendDependencies = {
    getCredentials: () => Promise.resolve({ address: 'contato@oryneo.com.br', displayName: 'ORYNEO', imapHost: 'imap.hostinger.com', imapPort: 993, smtpHost: 'smtp.hostinger.com', smtpPort: 465, password: 'segredo' }),
    beginOutbox: (_user, _input, messageId) => Promise.resolve({ state: 'pending', internetMessageId: messageId, acceptedAt: null }),
    findSentMessage: () => Promise.resolve(false),
    smtpSend: (_credentials, _envelope) => { sequence.push('smtp'); return Promise.resolve(); },
    markAccepted: () => { sequence.push('accepted'); return Promise.resolve(); },
    appendSent: () => { sequence.push('append'); return Promise.resolve(); },
    markSent: () => { sequence.push('sent'); return Promise.resolve(); },
    markFailed: () => Promise.resolve(),
  };
  const result = await sendMail(dependencies, 'user-1', compose);
  assert.equal(result.internetMessageId, '<22222222-2222-4222-8222-222222222222@oryneo.com.br>');
  assert.deepEqual(sequence, ['smtp', 'accepted', 'append', 'sent']);
});

Deno.test('mail-api exige JWT e associação ao CRM antes de executar ação', async () => {
  let invoked = false;
  const handler = createMailApiHandler({
    authenticate: () => Promise.resolve(null),
    isMember: () => Promise.resolve(false),
    execute: () => { invoked = true; return Promise.resolve({ ok: true }); },
  });
  const response = await handler(new Request('https://example.test/mail-api', { method: 'POST', body: JSON.stringify({ action: 'sync-now' }) }));
  assert.equal(response.status, 401);
  assert.equal(invoked, false);

  const nonMember = createMailApiHandler({
    authenticate: () => Promise.resolve('user-1'),
    isMember: () => Promise.resolve(false),
    execute: () => Promise.resolve({ ok: true }),
  });
  const forbidden = await nonMember(new Request('https://example.test/mail-api', {
    method: 'POST', headers: { authorization: 'Bearer jwt' }, body: JSON.stringify({ action: 'sync-now' }),
  }));
  assert.equal(forbidden.status, 403);
});

Deno.test('mail-api traduz conflito de revisão sem vazar detalhe interno', async () => {
  const handler = createMailApiHandler({
    authenticate: () => Promise.resolve('user-1'),
    isMember: () => Promise.resolve(true),
    execute: () => Promise.reject(new Error('DRAFT_CONFLICT: detalhe privado')),
  });
  const response = await handler(new Request('https://example.test/mail-api', {
    method: 'POST', headers: { authorization: 'Bearer jwt' }, body: JSON.stringify({ action: 'save-draft' }),
  }));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { ok: false, error: 'DRAFT_CONFLICT' });
});
