import { ImapFrameReader, parseFetchFlags, parseFetchFrames, parseListResponse, parseSelectState, quoteImap, type ImapFetchedFlags, type ImapFetchedMessage, type ImapFrame, type ImapListEntry, type ImapSelectState } from './protocol.ts';

export interface MailConnection {
  read(target: Uint8Array): Promise<number | null>;
  write(source: Uint8Array): Promise<number>;
  close(): void;
}

export type MailConnector = (host: string, port: number) => Promise<MailConnection>;

export type MailServerConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  timeoutMs?: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const defaultConnector: MailConnector = async (host, port) => await Deno.connectTls({ hostname: host, port });

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timeout: number | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      onTimeout();
      reject(new Error('Tempo limite de conexão excedido.'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function writeAll(connection: MailConnection, bytes: Uint8Array, timeoutMs: number): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await withTimeout(connection.write(bytes.subarray(offset)), timeoutMs, () => connection.close());
    if (written <= 0) throw new Error('Conexão encerrada durante a escrita.');
    offset += written;
  }
}

export class ImapClient {
  #connection: MailConnection | null = null;
  #reader = new ImapFrameReader();
  #frames: ImapFrame[] = [];
  #tag = 0;
  readonly #timeoutMs: number;

  constructor(private readonly config: MailServerConfig, private readonly connector: MailConnector = defaultConnector) {
    this.#timeoutMs = config.timeoutMs ?? 20_000;
  }

  async connect(): Promise<void> {
    this.#connection = await withTimeout(this.connector(this.config.host, this.config.port), this.#timeoutMs, () => {});
    const greeting = await this.#readFrame();
    if (!/^\* (?:OK|PREAUTH)\b/i.test(greeting.line)) {
      this.close();
      throw new Error('IMAP recusou a conexão.');
    }
  }

  async login(): Promise<void> {
    await this.#command(`LOGIN ${quoteImap(this.config.username)} ${quoteImap(this.config.password)}`);
  }

  async list(): Promise<ImapListEntry[]> {
    const frames = await this.#command('LIST "" "*"');
    return frames.map((frame) => parseListResponse(frame.line)).filter((entry): entry is ImapListEntry => entry !== null);
  }

  async select(mailbox: string): Promise<ImapSelectState> {
    const frames = await this.#command(`SELECT ${quoteImap(mailbox)}`);
    return parseSelectState(frames.map((frame) => frame.line));
  }

  async fetchUids(first: number, last: number | '*' = '*'): Promise<ImapFetchedMessage[]> {
    if (!Number.isSafeInteger(first) || first < 1) throw new Error('UID inicial inválido.');
    if (last !== '*' && (!Number.isSafeInteger(last) || last < first)) throw new Error('UID final inválido.');
    return parseFetchFrames(await this.#command(`UID FETCH ${first}:${last} (UID FLAGS RFC822.SIZE BODY.PEEK[])`));
  }

  async fetchFlags(first: number = 1, last: number | '*' = '*'): Promise<ImapFetchedFlags[]> {
    if (!Number.isSafeInteger(first) || first < 1) throw new Error('UID inicial inválido.');
    if (last !== '*' && (!Number.isSafeInteger(last) || last < first)) throw new Error('UID final inválido.');
    return parseFetchFlags(await this.#command(`UID FETCH ${first}:${last} (UID FLAGS)`));
  }

  async storeFlags(uid: number, flags: string[], mode: '+' | '-' | '=' = '='): Promise<void> {
    this.#assertUid(uid);
    this.#assertFlags(flags);
    const operation = mode === '=' ? 'FLAGS.SILENT' : `${mode}FLAGS.SILENT`;
    await this.#command(`UID STORE ${uid} ${operation} (${flags.join(' ')})`);
  }

  async move(uid: number, mailbox: string): Promise<void> {
    this.#assertUid(uid);
    await this.#command(`UID MOVE ${uid} ${quoteImap(mailbox)}`);
  }

  async append(mailbox: string, raw: Uint8Array, flags: string[] = ['\\Seen']): Promise<void> {
    this.#assertFlags(flags);
    const tag = this.#nextTag();
    await this.#write(`${tag} APPEND ${quoteImap(mailbox)} (${flags.join(' ')}) {${raw.length}}\r\n`);
    const continuation = await this.#readFrame();
    if (!/^\+/.test(continuation.line)) throw new Error('IMAP recusou o APPEND.');
    await writeAll(this.#requireConnection(), raw, this.#timeoutMs);
    await this.#write('\r\n');
    await this.#readTagged(tag);
  }

  async searchHeader(header: string, value: string): Promise<number[]> {
    if (!/^[A-Za-z0-9-]+$/.test(header)) throw new Error('Cabeçalho IMAP inválido.');
    const frames = await this.#command(`UID SEARCH HEADER ${header} ${quoteImap(value)}`);
    const line = frames.find((frame) => /^\* SEARCH(?: |$)/i.test(frame.line))?.line ?? '';
    return line.replace(/^\* SEARCH\s*/i, '').trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isSafeInteger);
  }

  async logout(): Promise<void> {
    try {
      if (this.#connection) await this.#command('LOGOUT');
    } finally {
      this.close();
    }
  }

  close(): void {
    this.#connection?.close();
    this.#connection = null;
  }

  #assertUid(uid: number): void {
    if (!Number.isSafeInteger(uid) || uid < 1) throw new Error('UID inválido.');
  }

  #assertFlags(flags: string[]): void {
    if (flags.some((flag) => !/^\\?[A-Za-z0-9$._-]+$/.test(flag))) throw new Error('Flag IMAP inválida.');
  }

  #nextTag(): string {
    this.#tag += 1;
    return `A${String(this.#tag).padStart(4, '0')}`;
  }

  async #command(command: string): Promise<ImapFrame[]> {
    const tag = this.#nextTag();
    await this.#write(`${tag} ${command}\r\n`);
    return await this.#readTagged(tag);
  }

  async #readTagged(tag: string): Promise<ImapFrame[]> {
    const frames: ImapFrame[] = [];
    while (true) {
      const frame = await this.#readFrame();
      if (!frame.line.startsWith(`${tag} `)) {
        frames.push(frame);
        continue;
      }
      if (!new RegExp(`^${tag} OK\\b`, 'i').test(frame.line)) throw new Error('Operação IMAP recusada.');
      return frames;
    }
  }

  async #readFrame(): Promise<ImapFrame> {
    while (!this.#frames.length) {
      const buffer = new Uint8Array(64 * 1024);
      const connection = this.#requireConnection();
      const read = await withTimeout(connection.read(buffer), this.#timeoutMs, () => this.close());
      if (read === null) throw new Error('Conexão IMAP encerrada inesperadamente.');
      this.#frames.push(...this.#reader.push(buffer.subarray(0, read)));
    }
    return this.#frames.shift()!;
  }

  async #write(value: string): Promise<void> {
    await writeAll(this.#requireConnection(), encoder.encode(value), this.#timeoutMs);
  }

  #requireConnection(): MailConnection {
    if (!this.#connection) throw new Error('IMAP não conectado.');
    return this.#connection;
  }
}

export type SmtpEnvelope = { from: string; recipients: string[]; raw: Uint8Array };
export type SmtpSendResult = { response: string };

export class SmtpClient {
  #connection: MailConnection | null = null;
  #reader = new ImapFrameReader(1024 * 1024);
  #lines: string[] = [];
  readonly #timeoutMs: number;

  constructor(private readonly config: MailServerConfig, private readonly connector: MailConnector = defaultConnector) {
    this.#timeoutMs = config.timeoutMs ?? 20_000;
  }

  async send(envelope: SmtpEnvelope): Promise<SmtpSendResult> {
    this.#validateEnvelope(envelope);
    this.#connection = await withTimeout(this.connector(this.config.host, this.config.port), this.#timeoutMs, () => {});
    try {
      await this.#expect([220]);
      await this.#write('EHLO oryneo-crm\r\n');
      await this.#expect([250]);
      await this.#write('AUTH LOGIN\r\n');
      await this.#expect([334]);
      await this.#write(`${this.#base64(this.config.username)}\r\n`);
      await this.#expect([334]);
      await this.#write(`${this.#base64(this.config.password)}\r\n`);
      await this.#expect([235]);
      await this.#write(`MAIL FROM:<${envelope.from}>\r\n`);
      await this.#expect([250]);
      for (const recipient of envelope.recipients) {
        await this.#write(`RCPT TO:<${recipient}>\r\n`);
        await this.#expect([250, 251]);
      }
      await this.#write('DATA\r\n');
      await this.#expect([354]);
      const source = decoder.decode(envelope.raw).replace(/\r?\n/g, '\r\n').replace(/(^|\r\n)\./g, '$1..');
      await this.#write(`${source.replace(/\r\n$/, '')}\r\n.\r\n`);
      const accepted = await this.#expect([250]);
      await this.#write('QUIT\r\n');
      await this.#expect([221]);
      return { response: accepted.message };
    } finally {
      this.#connection?.close();
      this.#connection = null;
    }
  }

  #validateEnvelope(envelope: SmtpEnvelope): void {
    const addresses = [envelope.from, ...envelope.recipients];
    if (!envelope.recipients.length || addresses.some((address) => /[\r\n\0]/.test(address) || !/^[^\s@<>]+@[^\s@<>]+$/.test(address))) {
      throw new Error('Envelope SMTP inválido.');
    }
  }

  #base64(value: string): string {
    const bytes = encoder.encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  async #expect(allowed: number[]): Promise<{ code: number; message: string }> {
    const first = await this.#readLine();
    const match = first.match(/^(\d{3})([ -])(.*)$/);
    if (!match) throw new Error('Resposta SMTP inválida.');
    const code = Number(match[1]);
    let message = match[3];
    if (match[2] === '-') {
      while (true) {
        const line = await this.#readLine();
        const continuation = line.match(/^(\d{3})([ -])(.*)$/);
        if (!continuation || Number(continuation[1]) !== code) throw new Error('Resposta SMTP inválida.');
        message = continuation[3];
        if (continuation[2] === ' ') break;
      }
    }
    if (!allowed.includes(code)) throw new Error(`Operação SMTP recusada (${code}).`);
    return { code, message };
  }

  async #readLine(): Promise<string> {
    while (!this.#lines.length) {
      const buffer = new Uint8Array(16 * 1024);
      const connection = this.#requireConnection();
      const read = await withTimeout(connection.read(buffer), this.#timeoutMs, () => this.#connection?.close());
      if (read === null) throw new Error('Conexão SMTP encerrada inesperadamente.');
      this.#lines.push(...this.#reader.push(buffer.subarray(0, read)).map((frame) => frame.line));
    }
    return this.#lines.shift()!;
  }

  async #write(value: string): Promise<void> {
    await writeAll(this.#requireConnection(), encoder.encode(value), this.#timeoutMs);
  }

  #requireConnection(): MailConnection {
    if (!this.#connection) throw new Error('SMTP não conectado.');
    return this.#connection;
  }
}
