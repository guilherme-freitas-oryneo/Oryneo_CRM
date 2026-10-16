const ORYNEO_WHATSAPP_URL = 'https://wa.me/5521974510932';

export type ContactIntent = 'conversation' | 'contract';
export type BillingCycle = 'monthly' | 'annual';
export type AddOn = 'landing-page' | 'traffic';

export interface FirstContactInput {
  intent: ContactIntent;
  firstName: string;
  company: string;
  plan: 'Start' | 'Growth' | 'Scale';
  cycle: BillingCycle;
  addOns: AddOn[];
  goals?: string[];
  primaryGoal?: string;
  acquisitionChannels?: string[];
  primaryAcquisitionChannel?: string;
  acquisitionChannel?: string;
  logoUrl?: string;
}

export interface RenderedFirstContactEmail {
  subject: string;
  preheader: string;
  text: string;
  html: string;
}

const CHANNEL_CONTEXT: Record<string, string> = {
  'Indicações e parcerias':
    'Como indicações e parcerias já têm peso na aquisição, o diagnóstico vai mostrar como preservar essa força e dar previsibilidade ao que acontece depois de cada contato.',
  'Instagram e Facebook':
    'Vamos observar como os contatos vindos de Instagram e Facebook são captados, atendidos e acompanhados até a decisão.',
  Google:
    'Vamos conectar os pontos entre busca, conversão e avanço comercial para identificar onde existe perda de oportunidade.',
  'Prospecção ativa':
    'O diagnóstico vai partir da sua cadência atual para organizar abordagem, acompanhamento e próximos passos.',
  'Portais e marketplaces':
    'Vamos avaliar como reunir contatos de diferentes origens dentro de um fluxo único, com contexto e prioridade.',
  'Loja física e eventos':
    'O foco será transformar contatos offline em oportunidades acompanháveis, sem perder o histórico da conversa.',
  'Ainda não temos um canal previsível':
    'Vamos desenhar o primeiro processo de aquisição mensurável, começando pelo que faz sentido para o momento da empresa.',
  'Outro canal':
    'O primeiro passo será entender o fluxo atual e localizar os pontos com maior potencial de ganho.',
};

function cleanText(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function unique(values: unknown[] | undefined): string[] {
  return [...new Set((values ?? []).map(cleanText).filter(Boolean))];
}

function humanList(values: string[]): string {
  if (values.length < 2) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} e ${values[1]}`;
  return `${values.slice(0, -1).join(', ')} e ${values.at(-1)}`;
}

function selectionSummary(input: FirstContactInput): string {
  const cycle = input.cycle === 'annual' ? 'anual' : 'mensal';
  const additions: string[] = [];
  if (input.addOns.includes('landing-page')) additions.push('landing page de conversão');
  if (input.addOns.includes('traffic')) additions.push('gestão de tráfego pago');
  if (additions.length === 0) return `plano ${input.plan}, no ciclo ${cycle}`;
  return `plano ${input.plan}, no ciclo ${cycle}, com ${humanList(additions)}`;
}

function acquisitionContext(input: FirstContactInput): string {
  const modern = unique(input.acquisitionChannels);
  const legacy = cleanText(input.acquisitionChannel);
  const channels = modern.length ? modern : (legacy ? [legacy] : []);
  if (!channels.length) {
    return 'Na conversa, vamos confirmar como as oportunidades chegam hoje antes de sugerir qualquer mudança no processo.';
  }
  if (channels.includes('Ainda não temos um canal previsível')) {
    return CHANNEL_CONTEXT['Ainda não temos um canal previsível'];
  }
  if (channels.length === 1) return CHANNEL_CONTEXT[channels[0]] ?? CHANNEL_CONTEXT['Outro canal'];

  const requestedPrimary = cleanText(input.primaryAcquisitionChannel);
  const primary = channels.includes(requestedPrimary) ? requestedPrimary : '';
  if (channels.length <= 3) {
    if (!primary) {
      return `Você indicou ${humanList(channels)} como frentes atuais. Vamos entender o papel de cada uma antes de definir onde concentrar o diagnóstico.`;
    }
    const complementary = channels.filter((channel) => channel !== primary);
    const verb = complementary.length === 1 ? 'entra' : 'entram';
    return `${CHANNEL_CONTEXT[primary] ?? CHANNEL_CONTEXT['Outro canal']} Também ${verb} no contexto ${humanList(complementary)}.`;
  }

  const reference = primary ? `Você apontou ${primary} como referência hoje. ` : '';
  return `${reference}Como a aquisição acontece em diferentes frentes, o diagnóstico vai mapear o papel de cada uma e onde o acompanhamento comercial perde continuidade.`;
}

function goalContext(input: FirstContactInput): string {
  const goals = unique(input.goals);
  const primary = cleanText(input.primaryGoal);
  if (primary && (!goals.length || goals.includes(primary))) return `O objetivo indicado como prioridade foi: ${primary}.`;
  if (goals.length) return `Entre os objetivos informados estão ${humanList(goals)}.`;
  if (primary) return `O objetivo indicado foi: ${primary}.`;
  return 'Na conversa, vamos confirmar qual resultado precisa avançar primeiro.';
}

export function renderFirstContactEmail(input: FirstContactInput): RenderedFirstContactEmail {
  const intent = input.intent === 'contract' ? 'contract' : 'conversation';
  const firstName = cleanText(input.firstName);
  const company = cleanText(input.company);
  const subject = intent === 'contract'
    ? 'Próximo passo da sua solicitação — ORYNEO'
    : 'Sua solicitação na ORYNEO';
  const preheader = intent === 'contract'
    ? `Vamos validar a configuração escolhida para a ${company}.`
    : `Recebemos o contexto da ${company} e já temos um bom ponto de partida.`;
  const selection = selectionSummary(input);
  const opening = intent === 'contract'
    ? `Recebi sua solicitação para avançar com o ${selection}. Antes de formalizarmos a contratação, quero validar a configuração escolhida e alinhar os próximos passos com o momento da ${company}.`
    : `Recebi sua solicitação e vi que você está avaliando o ${selection}. O contexto que compartilhou sobre a ${company} já nos dá um bom ponto de partida para a conversa.`;
  const goal = goalContext(input);
  const channel = acquisitionContext(input);
  const transition = intent === 'contract'
    ? 'Essa conversa é breve e evita que uma decisão importante comece com alguma premissa desalinhada.'
    : 'Em uma conversa breve, conseguimos transformar essas informações em um diagnóstico inicial e indicar o próximo passo mais coerente.';
  const question = 'Qual período funciona melhor para você: manhã ou tarde?';
  const greeting = `Olá, ${firstName}.`;
  const signature = ['Guilherme', 'ORYNEO', 'Crescimento em sistema.'];

  const text = [
    greeting,
    '',
    opening,
    '',
    goal,
    channel,
    '',
    transition,
    '',
    question,
    '',
    'Conversar pelo WhatsApp: ' + ORYNEO_WHATSAPP_URL,
    '',
    ...signature,
  ].join('\n');

  const paragraph = (value: string, style = 'margin:0 0 20px;') =>
    `<p style="${style}">${escapeHtml(value)}</p>`;
  const logoUrl = cleanText(input.logoUrl);
  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" width="132" alt="ORYNEO" style="display:block;width:132px;max-width:100%;height:auto;border:0;">`
    : '<strong style="display:block;color:#0F1115;font-size:18px;letter-spacing:.12em;">ORYNEO</strong>';

  const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(subject)}</title>
    <style>
      @media screen and (max-width: 480px) {
        .email-outer { padding: 18px 8px !important; }
        .email-header { padding: 28px 26px 10px !important; }
        .email-content { padding: 14px 26px 34px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:#F8F7F4;color:#0F1115;font-family:Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#F8F7F4;">
      <tr>
        <td align="center" class="email-outer" style="padding:32px 16px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden;">
            <tr><td style="height:5px;background:#4F6BFF;font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr><td class="email-header" style="padding:36px 44px 14px;">${logo}</td></tr>
            <tr>
              <td class="email-content" style="padding:18px 44px 42px;font-size:16px;line-height:1.65;color:#0F1115;">
                ${paragraph(greeting)}
                ${paragraph(opening)}
                ${paragraph(goal, 'margin:0 0 8px;')}
                ${paragraph(channel)}
                ${paragraph(transition)}
                ${paragraph(question, 'margin:0 0 24px;font-weight:600;')}
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr><td style="border-radius:8px;background:#4F6BFF;"><a href="${ORYNEO_WHATSAPP_URL}" style="display:inline-block;padding:13px 20px;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;">Conversar pelo WhatsApp</a></td></tr>
                </table>
                <p style="margin:30px 0 0;color:#6B7280;font-size:14px;line-height:1.55;">${escapeHtml(signature[0])}<br><strong style="color:#0F1115;">${escapeHtml(signature[1])}</strong><br>${escapeHtml(signature[2])}</p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0;color:#6B7280;font-size:12px;line-height:1.5;">marketing, vendas e tecnologia como um sistema.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, preheader, text, html };
}
