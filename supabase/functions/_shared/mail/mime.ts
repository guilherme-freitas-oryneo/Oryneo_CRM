import { PostalMime } from './deps.ts';

export type MailboxAddress = { name?: string | null; address: string };
export type OutgoingAttachment = { filename: string; mimeType: string; content: Uint8Array; contentId?: string; inline?: boolean };
export type BuildMimeInput = {
  messageId: string;
  date?: Date;
  from: MailboxAddress;
  to: MailboxAddress[];
  cc?: MailboxAddress[];
  bcc?: MailboxAddress[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: OutgoingAttachment[];
};

export type NormalizedAttachment = {
  filename: string;
  mimeType: string;
  disposition: string | null;
  contentId: string | null;
  inline: boolean;
  content: Uint8Array;
};

export type NormalizedMessage = {
  internetMessageId: string;
  inReplyTo: string | null;
  references: string[];
  from: MailboxAddress;
  to: MailboxAddress[];
  cc: MailboxAddress[];
  bcc: MailboxAddress[];
  subject: string;
  date: string | null;
  text: string;
  html: string;
  attachments: NormalizedAttachment[];
};

const encoder = new TextEncoder();

function assertHeader(value: string): void {
  if (/[\r\n\0]/.test(value)) throw new Error('Cabeçalho inválido.');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function foldedBase64(bytes: Uint8Array): string {
  return base64(bytes).match(/.{1,76}/g)?.join('\r\n') ?? '';
}

function encodeWord(value: string): string {
  assertHeader(value);
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${base64(encoder.encode(value))}?=`;
}

function validateAddress(address: MailboxAddress): void {
  assertHeader(address.address);
  if (address.name) assertHeader(address.name);
  if (!/^[^\s@<>]+@[^\s@<>]+$/.test(address.address)) throw new Error('Cabeçalho inválido: endereço de e-mail.');
}

function formatAddress(address: MailboxAddress): string {
  validateAddress(address);
  const name = address.name?.trim();
  return name ? `${encodeWord(name)} <${address.address}>` : address.address;
}

function formatAddresses(addresses: MailboxAddress[]): string {
  return addresses.map(formatAddress).join(', ');
}

async function boundaryFor(messageId: string, suffix: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${messageId}:${suffix}`)));
  return `=_oryneo_${base64(digest.slice(0, 12)).replaceAll(/[^a-zA-Z0-9]/g, '')}`;
}

function textPart(contentType: string, content: string): string[] {
  return [
    `Content-Type: ${contentType}; charset=utf-8`,
    'Content-Transfer-Encoding: base64',
    '',
    foldedBase64(encoder.encode(content)),
  ];
}

export async function buildMimeMessage(input: BuildMimeInput): Promise<Uint8Array> {
  assertHeader(input.messageId);
  assertHeader(input.subject);
  if (!/^<[^<>\s@]+@[^<>\s@]+>$/.test(input.messageId)) throw new Error('Cabeçalho inválido: Message-ID.');
  validateAddress(input.from);
  if (!input.to.length) throw new Error('Cabeçalho inválido: destinatário ausente.');
  [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])].forEach(validateAddress);
  input.inReplyTo && assertHeader(input.inReplyTo);
  input.references?.forEach(assertHeader);
  input.attachments?.forEach((attachment) => {
    assertHeader(attachment.filename);
    assertHeader(attachment.mimeType);
    if (attachment.contentId) assertHeader(attachment.contentId);
  });

  const alternativeBoundary = await boundaryFor(input.messageId, 'alternative');
  const mixedBoundary = await boundaryFor(input.messageId, 'mixed');
  const headers = [
    `Date: ${(input.date ?? new Date()).toUTCString()}`,
    `Message-ID: ${input.messageId}`,
    `From: ${formatAddress(input.from)}`,
    `To: ${formatAddresses(input.to)}`,
  ];
  if (input.cc?.length) headers.push(`Cc: ${formatAddresses(input.cc)}`);
  headers.push(`Subject: ${encodeWord(input.subject)}`);
  if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
  if (input.references?.length) headers.push(`References: ${input.references.join(' ')}`);
  headers.push('MIME-Version: 1.0');

  const body: string[] = [];
  const attachments = input.attachments ?? [];
  if (attachments.length) {
    headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);
    body.push(`--${mixedBoundary}`);
  }
  if (input.html) {
    if (attachments.length) body.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`, '');
    else headers.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`);
    body.push(`--${alternativeBoundary}`, ...textPart('text/plain', input.text));
    body.push(`--${alternativeBoundary}`, ...textPart('text/html', input.html));
    body.push(`--${alternativeBoundary}--`);
  } else if (!attachments.length) {
    headers.push('Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64');
    body.push(foldedBase64(encoder.encode(input.text)));
  } else {
    body.push(...textPart('text/plain', input.text));
  }
  for (const attachment of attachments) {
    const encodedFilename = encodeURIComponent(attachment.filename).replaceAll("'", '%27');
    body.push(
      `--${mixedBoundary}`,
      `Content-Type: ${attachment.mimeType}`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: ${attachment.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedFilename}`,
    );
    if (attachment.contentId) body.push(`Content-ID: <${attachment.contentId.replace(/^<|>$/g, '')}>`);
    body.push('', foldedBase64(attachment.content));
  }
  if (attachments.length) body.push(`--${mixedBoundary}--`);
  return encoder.encode([...headers, '', ...body, ''].join('\r\n'));
}

type ParsedAddress = { name?: string; address?: string; group?: ParsedAddress[] };

function flattenAddresses(value: ParsedAddress[] | undefined): MailboxAddress[] {
  const result: MailboxAddress[] = [];
  for (const item of value ?? []) {
    if (item.group) result.push(...flattenAddresses(item.group));
    else if (item.address) result.push({ name: item.name || undefined, address: item.address.toLowerCase() });
  }
  return result;
}

function attachmentBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (content instanceof Uint8Array) return content.slice();
  if (typeof content !== 'string') return new Uint8Array(content);
  const binary = atob(content);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function normalizeMessage(raw: Uint8Array): Promise<NormalizedMessage> {
  const parsed = await PostalMime.parse(raw, { maxNestingDepth: 50, maxHeadersSize: 256 * 1024 });
  const from = flattenAddresses(parsed.from ? [parsed.from as ParsedAddress] : [])[0] ?? { address: '' };
  const referencesValue = parsed.references as unknown;
  const references = Array.isArray(referencesValue)
    ? referencesValue.map(String)
    : typeof referencesValue === 'string'
      ? referencesValue.match(/<[^>]+>/g) ?? []
      : [];
  return {
    internetMessageId: parsed.messageId ?? '',
    inReplyTo: parsed.inReplyTo ?? null,
    references,
    from,
    to: flattenAddresses(parsed.to as ParsedAddress[] | undefined),
    cc: flattenAddresses(parsed.cc as ParsedAddress[] | undefined),
    bcc: flattenAddresses(parsed.bcc as ParsedAddress[] | undefined),
    subject: parsed.subject ?? '',
    date: parsed.date ?? null,
    text: parsed.text ?? '',
    html: parsed.html ?? '',
    attachments: parsed.attachments.map((attachment) => ({
      filename: attachment.filename ?? 'anexo',
      mimeType: attachment.mimeType,
      disposition: attachment.disposition,
      contentId: attachment.contentId?.replace(/^<|>$/g, '') ?? null,
      inline: attachment.disposition === 'inline' || attachment.related === true,
      content: attachmentBytes(attachment.content),
    })),
  };
}
