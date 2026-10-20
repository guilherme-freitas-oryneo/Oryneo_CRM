import type { RequestReceivedEmail, RequestReceivedInput } from './request-received-template.ts';

const WHATSAPP_URL = 'https://wa.me/5521974510932';
const LOGO_URL = 'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/oryneo-wordmark-mono-reverse.png';
const clean = (value: string, max: number) => value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const esc = (value: string) => value.replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[character]!);

export function renderImplementationStartedEmail(input: RequestReceivedInput): RequestReceivedEmail {
  const firstName = clean(input.firstName, 60) || 'cliente';
  const company = clean(input.company, 120) || 'sua empresa';
  const subject = 'Implantação iniciada · ORYNEO';
  const preheader = 'A equipe ORYNEO iniciou a organização dos próximos passos da sua implantação.';
  const text = [`Olá, ${firstName}.`, '', `A implantação da ${company} foi iniciada.`, 'Nossa equipe está organizando os acessos, informações e alinhamentos previstos no escopo contratado.', '', `Falar com a ORYNEO: ${WHATSAPP_URL}`, '', 'Equipe ORYNEO · Crescimento em sistema.'].join('\n');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body style="margin:0;background:#f6f5f2;color:#171b24;font-family:Inter,Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #dedfe4"><tr><td style="padding:30px 40px;background:#171b24"><img src="${LOGO_URL}" width="168" alt="ORYNEO" style="display:block;max-width:100%;height:auto"></td></tr><tr><td style="padding:42px 40px"><p style="margin:0 0 16px;color:#4f5fd7;font-size:11px;font-weight:700;letter-spacing:1.6px">IMPLANTAÇÃO INICIADA</p><h1 style="margin:0 0 24px;font-size:32px;line-height:1.18;letter-spacing:-1px">Agora começa a organização da operação.</h1><p style="margin:0 0 16px;color:#626a78;font-size:15px;line-height:1.75">Olá, ${esc(firstName)}.</p><p style="margin:0 0 16px;color:#626a78;font-size:15px;line-height:1.75">A implantação da <strong style="color:#171b24">${esc(company)}</strong> foi iniciada. Nossa equipe está organizando os acessos, informações e alinhamentos previstos no escopo contratado.</p><p style="margin:28px 0 0"><a href="${WHATSAPP_URL}" style="display:inline-block;padding:13px 19px;border:1px solid #171b24;color:#171b24;text-decoration:none;font-size:13px;font-weight:700">FALAR COM A ORYNEO</a></p></td></tr></table></td></tr></table></body></html>`;
  return { subject, preheader, text, html };
}
