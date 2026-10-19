export type RequestReceivedInput = { firstName: string; company: string };
export type RequestReceivedEmail = { subject: string; preheader: string; text: string; html: string };

const WHATSAPP_URL = 'https://wa.me/5521974510932';
const LOGO_URL = 'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/oryneo-wordmark-mono-reverse.png';

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export function renderRequestReceivedEmail(input: RequestReceivedInput): RequestReceivedEmail {
  const firstName = clean(input.firstName, 60) || 'cliente';
  const company = clean(input.company, 120) || 'sua empresa';
  const subject = 'Recebemos sua solicitação · ORYNEO';
  const preheader = 'Sua solicitação foi registrada e a equipe já pode seguir com o próximo passo.';
  const paragraphs = [
    `Olá, ${firstName}.`,
    `Recebemos a solicitação da ${company} e ela foi registrada para análise da equipe ORYNEO.`,
    'Se precisar complementar alguma informação, use o WhatsApp oficial abaixo.',
  ];
  const text = [
    ...paragraphs,
    '',
    `Falar no WhatsApp: ${WHATSAPP_URL}`,
    '',
    'A ORYNEO nunca solicita senha ou dados completos de cartão por e-mail.',
    '',
    'Equipe ORYNEO · Crescimento em sistema.',
  ].join('\n');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title><style>@media(max-width:600px){.ory-pad{padding:28px 23px!important}.ory-h1{font-size:27px!important}.ory-outer{padding:12px!important}}</style></head><body style="margin:0;padding:0;background:#F8F7F4;color:#172133;font-family:Arial,Helvetica,sans-serif"><div style="display:none;opacity:0;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F8F7F4"><tr><td class="ory-outer" align="center" style="padding:40px 16px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #e9ebf0;border-collapse:separate;border-spacing:0"><tr><td class="ory-pad" style="padding:33px 42px 25px;background:#0F1115;color:#fff"><img src="${LOGO_URL}" width="172" height="32" alt="ORYNEO" style="display:block;width:172px;max-width:100%;height:auto;border:0"></td></tr><tr><td class="ory-pad" style="padding:37px 42px 39px"><p style="font-size:11px;color:#4357E8;letter-spacing:1.6px;font-weight:bold;margin:0 0 15px">SOLICITAÇÃO RECEBIDA</p><h1 class="ory-h1" style="font-size:32px;font-weight:700;letter-spacing:-1.2px;line-height:1.18;color:#0F1115;margin:0 0 23px">Sua solicitação chegou até nós.</h1>${paragraphs.map((paragraph) => `<p style="font-size:15px;line-height:1.77;color:#6B7280;margin:0 0 17px">${escapeHtml(paragraph)}</p>`).join('')}<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 28px"><tr><td style="border:1px solid #25D366;border-radius:8px"><a href="${WHATSAPP_URL}" style="display:inline-block;color:#128C4A;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;padding:13px 20px;border-radius:8px">FALAR NO WHATSAPP</a></td></tr></table><p style="padding:15px 17px;border-left:3px solid #4F6BFF;background:#F1F3FF;color:#5d657a;font-size:12px;line-height:1.7;margin:27px 0">A ORYNEO nunca solicita senha ou dados completos de cartão por e-mail.</p><p style="font-size:13px;color:#5d6676;line-height:1.8;margin:30px 0 0">Dúvidas? Responda este e-mail ou escreva para <a style="color:#4357E8" href="mailto:contato@oryneo.com.br">contato@oryneo.com.br</a>.<br><strong style="color:#0F1115">Equipe ORYNEO</strong></p></td></tr></table></td></tr></table></body></html>`;
  return { subject, preheader, text, html };
}
