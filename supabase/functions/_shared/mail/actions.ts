import { buildMimeMessage, type MailboxAddress, type OutgoingAttachment } from './mime.ts';
import type { MailCredentials } from './sync.ts';

export type ComposeInput = {
  mailboxId: string;
  idempotencyKey: string;
  draftId?: string | null;
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

export type OutboxState = {
  state: 'pending' | 'sending' | 'sent' | 'failed';
  internetMessageId: string;
  acceptedAt: string | null;
};

export type MailSendDependencies = {
  getCredentials(mailboxId: string): Promise<MailCredentials>;
  beginOutbox(userId: string, input: ComposeInput, internetMessageId: string): Promise<OutboxState>;
  findSentMessage(credentials: MailCredentials, internetMessageId: string): Promise<boolean>;
  smtpSend(credentials: MailCredentials, envelope: { from: string; recipients: string[]; raw: Uint8Array }): Promise<void>;
  appendSent(credentials: MailCredentials, raw: Uint8Array): Promise<void>;
  markAccepted(idempotencyKey: string): Promise<void>;
  markSent(idempotencyKey: string): Promise<void>;
  markFailed(idempotencyKey: string, errorCode: string): Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^[^\s@<>]+@[^\s@<>]+$/;

function invalidHeader(value: string): boolean {
  return /[\r\n\0]/.test(value);
}

export function validateCompose(input: ComposeInput): void {
  if (!UUID.test(input.mailboxId) || !UUID.test(input.idempotencyKey)) throw new Error('INVALID_MESSAGE');
  if (!input.to?.length || input.to.length + (input.cc?.length ?? 0) + (input.bcc?.length ?? 0) > 100) throw new Error('INVALID_RECIPIENT');
  for (const participant of [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])]) {
    if (!ADDRESS.test(participant.address) || invalidHeader(participant.address) || invalidHeader(participant.name ?? '')) throw new Error('INVALID_RECIPIENT');
  }
  if (invalidHeader(input.subject) || input.subject.length > 998 || input.text.length > 10 * 1024 * 1024 || (input.html?.length ?? 0) > 10 * 1024 * 1024) {
    throw new Error('INVALID_MESSAGE');
  }
  if (input.inReplyTo && invalidHeader(input.inReplyTo)) throw new Error('INVALID_MESSAGE');
  if (input.references?.some(invalidHeader)) throw new Error('INVALID_MESSAGE');
  const attachments = input.attachments ?? [];
  let aggregate = 0;
  for (const attachment of attachments) {
    if (!attachment.filename || invalidHeader(attachment.filename) || invalidHeader(attachment.mimeType)) throw new Error('INVALID_ATTACHMENT');
    if (attachment.content.byteLength > 15 * 1024 * 1024) throw new Error('ATTACHMENT_TOO_LARGE');
    aggregate += attachment.content.byteLength;
  }
  if (aggregate > 20 * 1024 * 1024) throw new Error('ATTACHMENTS_TOO_LARGE');
}

export async function sendMail(dependencies: MailSendDependencies, userId: string, input: ComposeInput): Promise<{ internetMessageId: string; alreadyAccepted: boolean }> {
  validateCompose(input);
  const deterministicId = `<${input.idempotencyKey.toLowerCase()}@oryneo.com.br>`;
  const outbox = await dependencies.beginOutbox(userId, input, deterministicId);
  if (outbox.state === 'sent') return { internetMessageId: outbox.internetMessageId, alreadyAccepted: true };
  const credentials = await dependencies.getCredentials(input.mailboxId);
  if (outbox.acceptedAt && await dependencies.findSentMessage(credentials, outbox.internetMessageId)) {
    await dependencies.markSent(input.idempotencyKey);
    return { internetMessageId: outbox.internetMessageId, alreadyAccepted: true };
  }

  const raw = await buildMimeMessage({
    messageId: outbox.internetMessageId,
    from: { name: credentials.displayName, address: credentials.address },
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    text: input.text,
    html: input.html,
    inReplyTo: input.inReplyTo,
    references: input.references,
    attachments: input.attachments,
  });
  try {
    await dependencies.smtpSend(credentials, {
      from: credentials.address,
      recipients: [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])].map((address) => address.address),
      raw,
    });
    await dependencies.markAccepted(input.idempotencyKey);
    await dependencies.appendSent(credentials, raw);
    await dependencies.markSent(input.idempotencyKey);
    return { internetMessageId: outbox.internetMessageId, alreadyAccepted: false };
  } catch (error) {
    const code = error instanceof Error && error.message === 'MAIL_APPEND' ? 'MAIL_APPEND' : 'MAIL_SEND';
    await dependencies.markFailed(input.idempotencyKey, code);
    throw new Error(code);
  }
}
