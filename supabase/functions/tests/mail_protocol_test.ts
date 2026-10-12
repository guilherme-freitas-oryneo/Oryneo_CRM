import assert from 'node:assert/strict';
import { ImapFrameReader, parseFetchFlags, parseFetchFrames, parseListResponse, parseSelectState, quoteImap } from '../_shared/mail/protocol.ts';
import { ImapClient, SmtpClient, type MailConnection } from '../_shared/mail/transport.ts';

const encoder = new TextEncoder();

Deno.test('ImapFrameReader remonta linhas e literais fragmentados sem interpretar o corpo', () => {
  const reader = new ImapFrameReader(1024);
  const prefix = encoder.encode('* 7 FETCH (UID 42 FLAGS (\\Seen) BODY[] {31}\r\nOlá\r\nA1 OK não é protocolo\r\n)\r\nA1 OK done\r\n');
  const splitInsideUtf8 = prefix.indexOf(0xc3) + 1;
  assert.deepEqual(reader.push(prefix.slice(0, splitInsideUtf8)), []);
  const frames = reader.push(prefix.slice(splitInsideUtf8));
  assert.equal(frames.length, 3);
  assert.equal(frames[0].line, '* 7 FETCH (UID 42 FLAGS (\\Seen) BODY[] {31}');
  assert.equal(new TextDecoder().decode(frames[0].literal), 'Olá\r\nA1 OK não é protocolo\r\n');
  assert.equal(frames[1].line, ')');
  assert.equal(frames[2].line, 'A1 OK done');
});

Deno.test('ImapFrameReader recusa literais acima do limite', () => {
  const reader = new ImapFrameReader(10);
  assert.throws(() => reader.push(encoder.encode('* 1 FETCH (BODY[] {11}\r\n')), /literal excede/i);
});

Deno.test('quoteImap escapa credenciais e recusa quebra de comando', () => {
  assert.equal(quoteImap('a"b\\c'), '"a\\"b\\\\c"');
  assert.throws(() => quoteImap('a\r\nLOGOUT'), /inválido/i);
});

Deno.test('parseListResponse entende delimitador, nome e uso especial', () => {
  assert.deepEqual(parseListResponse('* LIST (\\HasNoChildren \\Sent) "/" "INBOX.Sent"'), {
    attributes: ['\\HasNoChildren', '\\Sent'],
    delimiter: '/',
    name: 'INBOX.Sent',
  });
  assert.equal(parseListResponse('A1 OK done'), null);
});

Deno.test('parseSelectState lê estado de UID e contadores', () => {
  assert.deepEqual(parseSelectState([
    '* 42 EXISTS',
    '* 5 RECENT',
    '* OK [UIDVALIDITY 123456] UIDs valid',
    '* OK [UIDNEXT 99] next',
    '* OK [HIGHESTMODSEQ 777] modseq',
  ]), { exists: 42, recent: 5, uidValidity: 123456, uidNext: 99, highestModSeq: 777 });
});

Deno.test('parseFetchFrames extrai UID, flags e bytes exatos', () => {
  const reader = new ImapFrameReader();
  const frames = reader.push(encoder.encode('* 2 FETCH (UID 77 FLAGS (\\Seen \\Flagged) RFC822.SIZE 4 BODY[] {4}\r\ntest\r\n)\r\n'));
  assert.deepEqual(parseFetchFrames(frames), [{ sequence: 2, uid: 77, flags: ['\\Seen', '\\Flagged'], size: 4, raw: encoder.encode('test') }]);
});

Deno.test('parseFetchFlags reconcilia respostas sem baixar corpos', () => {
  const reader = new ImapFrameReader();
  const frames = reader.push(encoder.encode('* 2 FETCH (UID 77 FLAGS (\\Seen \\Flagged))\r\n* 3 FETCH (UID 81 FLAGS ())\r\n'));
  assert.deepEqual(parseFetchFlags(frames), [
    { sequence: 2, uid: 77, flags: ['\\Seen', '\\Flagged'] },
    { sequence: 3, uid: 81, flags: [] },
  ]);
});

class ScriptedConnection implements MailConnection {
  #chunks: Uint8Array[];
  writes: string[] = [];
  closed = false;

  constructor(responses: string[]) {
    this.#chunks = responses.map((value) => encoder.encode(value));
  }

  read(target: Uint8Array): Promise<number | null> {
    const chunk = this.#chunks.shift();
    if (!chunk) return Promise.resolve(null);
    const length = Math.min(target.length, chunk.length);
    target.set(chunk.subarray(0, length));
    if (length < chunk.length) this.#chunks.unshift(chunk.subarray(length));
    return Promise.resolve(length);
  }

  write(source: Uint8Array): Promise<number> {
    this.writes.push(new TextDecoder().decode(source));
    return Promise.resolve(source.length);
  }

  close(): void {
    this.closed = true;
  }
}

Deno.test('ImapClient executa login, descoberta, seleção e fetch com tags sequenciais', async () => {
  const connection = new ScriptedConnection([
    '* OK Hostinger IMAP ready\r\n',
    'A0001 OK authenticated\r\n',
    '* LIST (\\HasNoChildren \\Inbox) "/" "INBOX"\r\nA0002 OK listed\r\n',
    '* 1 EXISTS\r\n* OK [UIDVALIDITY 9] valid\r\n* OK [UIDNEXT 3] next\r\nA0003 OK selected\r\n',
    '* 1 FETCH (UID 2 FLAGS () RFC822.SIZE 4 BODY[] {4}\r\ntest\r\n)\r\nA0004 OK fetched\r\n',
    '* 1 FETCH (UID 2 FLAGS ())\r\nA0005 OK flags\r\n',
    'A0006 OK logout\r\n',
  ]);
  const client = new ImapClient({ host: 'imap.hostinger.com', port: 993, username: 'contato@oryneo.com.br', password: 'segredo' }, async () => connection);
  await client.connect();
  await client.login();
  assert.equal((await client.list())[0].name, 'INBOX');
  assert.equal((await client.select('INBOX')).uidValidity, 9);
  assert.equal((await client.fetchUids(2, 2))[0].uid, 2);
  assert.deepEqual(await client.fetchFlags(), [{ sequence: 1, uid: 2, flags: [] }]);
  await client.logout();
  assert.deepEqual(connection.writes.map((line) => line.split(' ')[0]), ['A0001', 'A0002', 'A0003', 'A0004', 'A0005', 'A0006']);
  assert.equal(connection.closed, true);
});

Deno.test('SmtpClient autentica, envia envelope completo e escapa pontos no DATA', async () => {
  const connection = new ScriptedConnection([
    '220 smtp ready\r\n',
    '250-smtp.hostinger.com\r\n250 AUTH LOGIN\r\n',
    '334 VXNlcm5hbWU6\r\n',
    '334 UGFzc3dvcmQ6\r\n',
    '235 authenticated\r\n',
    '250 sender ok\r\n',
    '250 recipient ok\r\n',
    '354 send data\r\n',
    '250 queued as abc\r\n',
    '221 bye\r\n',
  ]);
  const client = new SmtpClient({ host: 'smtp.hostinger.com', port: 465, username: 'contato@oryneo.com.br', password: 'segredo' }, async () => connection);
  const result = await client.send({
    from: 'contato@oryneo.com.br',
    recipients: ['destino@exemplo.com'],
    raw: encoder.encode('Subject: teste\r\n\r\n.primeira\r\nsegunda\r\n'),
  });
  assert.equal(result.response, 'queued as abc');
  assert.ok(connection.writes.some((value) => value.includes('..primeira\r\n')));
  assert.ok(connection.writes.some((value) => value === 'AUTH LOGIN\r\n'));
  assert.equal(connection.closed, true);
});
