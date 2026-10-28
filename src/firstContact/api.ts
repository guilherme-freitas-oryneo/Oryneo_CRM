import { getStatus, invokeMailAction } from '../mail/api';

export type SendFirstContactRequest = {
  dealId: string;
  idempotencyKey: string;
  resend?: boolean;
};

export type SendFirstContactResult = {
  internetMessageId: string;
  alreadyAccepted: boolean;
  sentAt: string;
};

const messages: Record<string, string> = {
  FIRST_CONTACT_STAGE: 'Este lead não está mais em Diagnóstico pendente. Atualize o pipeline antes de enviar.',
  FIRST_CONTACT_ALREADY_SENT: 'O primeiro e-mail já foi enviado. Use a opção de reenvio nos detalhes da oportunidade.',
  FIRST_CONTACT_RESEND: 'O reenvio não é necessário porque este lead ainda não recebeu o primeiro e-mail.',
  FIRST_CONTACT_INVALID_EMAIL: 'O e-mail deste lead não é válido. Corrija os dados antes de enviar.',
  FIRST_CONTACT_INCOMPLETE: 'Faltam dados comerciais para montar este e-mail com segurança.',
  FIRST_CONTACT_MAILBOX: 'A caixa de e-mail da ORYNEO não está disponível.',
  MAIL_IN_PROGRESS: 'Este envio já está em andamento. Aguarde alguns instantes e tente novamente.',
  MAIL_SEND: 'O servidor não aceitou o envio. Nenhum sucesso foi registrado; tente novamente.',
  MAIL_APPEND: 'O e-mail foi aceito, mas a cópia em Enviados precisa ser reparada. Tente novamente com segurança.',
};

export async function sendFirstContact(request: SendFirstContactRequest): Promise<SendFirstContactResult> {
  const status = await getStatus();
  if (!status.mailbox_id) throw new Error(messages.FIRST_CONTACT_MAILBOX);
  try {
    return await invokeMailAction<SendFirstContactResult>('send-first-contact', {
      dealId: request.dealId,
      mailboxId: status.mailbox_id,
      idempotencyKey: request.idempotencyKey,
      resend: request.resend === true,
    });
  } catch (reason) {
    const code = reason instanceof Error ? reason.message : '';
    throw new Error(messages[code] ?? 'Não foi possível enviar agora. Revise a conexão e tente novamente.');
  }
}
