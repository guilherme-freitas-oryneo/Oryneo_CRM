import assert from 'node:assert/strict';
import { buildMimeMessage, normalizeMessage } from '../_shared/mail/mime.ts';

const decoder = new TextDecoder();

Deno.test('buildMimeMessage cria multipart Unicode determinístico e omite Bcc do cabeçalho', async () => {
  const raw = await buildMimeMessage({
    messageId: '<oryneo-123@oryneo.com.br>',
    date: new Date('2026-10-12T18:00:00.000Z'),
    from: { name: 'ORYNEO', address: 'contato@oryneo.com.br' },
    to: [{ name: 'José', address: 'jose@exemplo.com' }],
    cc: [{ address: 'financeiro@exemplo.com' }],
    bcc: [{ address: 'oculto@exemplo.com' }],
    subject: 'Proposta – renovação',
    text: 'Olá José',
    html: '<p>Olá <strong>José</strong></p>',
    inReplyTo: '<anterior@exemplo.com>',
    references: ['<primeiro@exemplo.com>', '<anterior@exemplo.com>'],
    attachments: [{ filename: 'proposta.pdf', mimeType: 'application/pdf', content: new Uint8Array([0, 1, 2, 3]) }],
  });
  const source = decoder.decode(raw);
  assert.match(source, /^Date: Mon, 12 Oct 2026 18:00:00 GMT\r\n/m);
  assert.match(source, /Message-ID: <oryneo-123@oryneo\.com\.br>/);
  assert.match(source, /Subject: =\?UTF-8\?B\?/);
  assert.match(source, /In-Reply-To: <anterior@exemplo\.com>/);
  assert.match(source, /References: <primeiro@exemplo\.com> <anterior@exemplo\.com>/);
  assert.match(source, /Content-Disposition: attachment; filename\*=UTF-8''proposta\.pdf/);
  assert.doesNotMatch(source, /^Bcc:/m);
  assert.equal(source.includes('\n') && !source.replaceAll('\r\n', '').includes('\n'), true);
});

Deno.test('buildMimeMessage recusa injeção em cabeçalhos', async () => {
  await assert.rejects(() => buildMimeMessage({
    messageId: '<safe@oryneo.com.br>',
    from: { address: 'contato@oryneo.com.br' },
    to: [{ address: 'alvo@exemplo.com\r\nBcc: invasor@exemplo.com' }],
    subject: 'Seguro',
    text: 'teste',
  }), /cabeçalho inválido/i);
});

Deno.test('normalizeMessage interpreta alternativa, Unicode, CID e anexo binário', async () => {
  const raw = new TextEncoder().encode([
    'Message-ID: <entrada@exemplo.com>',
    'From: =?UTF-8?Q?Jos=C3=A9?= <jose@exemplo.com>',
    'To: contato@oryneo.com.br',
    'Subject: =?UTF-8?Q?Ol=C3=A1?=',
    'Date: Mon, 12 Oct 2026 15:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; boundary="outer"',
    '',
    '--outer',
    'Content-Type: multipart/alternative; boundary="inner"',
    '',
    '--inner',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Texto simples',
    '--inner',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Texto <img src="cid:logo"></p>',
    '--inner--',
    '--outer',
    'Content-Type: image/png; name="logo.png"',
    'Content-Transfer-Encoding: base64',
    'Content-ID: <logo>',
    'Content-Disposition: inline; filename="logo.png"',
    '',
    'AAECAw==',
    '--outer--',
    '',
  ].join('\r\n'));
  const message = await normalizeMessage(raw);
  assert.equal(message.internetMessageId, '<entrada@exemplo.com>');
  assert.deepEqual(message.from, { name: 'José', address: 'jose@exemplo.com' });
  assert.equal(message.subject, 'Olá');
  assert.equal(message.text.trim(), 'Texto simples');
  assert.match(message.html, /cid:logo/);
  assert.equal(message.attachments[0].contentId, 'logo');
  assert.deepEqual(message.attachments[0].content, new Uint8Array([0, 1, 2, 3]));
});
