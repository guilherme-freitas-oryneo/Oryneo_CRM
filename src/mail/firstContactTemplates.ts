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
  primaryGoal: string;
  acquisitionChannel: string;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function selectionSummary(input: FirstContactInput): string {
  const cycle = input.cycle === 'annual' ? 'anual' : 'mensal';
  const additions: string[] = [];
  if (input.addOns.includes('landing-page')) additions.push('landing page de conversão');
  if (input.addOns.includes('traffic')) additions.push('gestão de tráfego pago');

  if (additions.length === 0) return `plano ${input.plan}, no ciclo ${cycle}`;
  if (additions.length === 1) return `plano ${input.plan}, no ciclo ${cycle}, com ${additions[0]}`;
  return `plano ${input.plan}, no ciclo ${cycle}, com ${additions[0]} e ${additions[1]}`;
}

function contextFor(channel: string): string {
  return CHANNEL_CONTEXT[channel] ?? CHANNEL_CONTEXT['Outro canal'];
}

export function renderFirstContactEmail(input: FirstContactInput): RenderedFirstContactEmail {
  const isContract = input.intent === 'contract';
  const subject = isContract
    ? 'Próximo passo da sua solicitação — ORYNEO'
    : 'Sua solicitação na ORYNEO';
  const preheader = isContract
    ? `Vamos validar a configuração escolhida para a ${input.company}.`
    : `Recebemos o contexto da ${input.company} e já temos um bom ponto de partida.`;
  const selection = selectionSummary(input);
  const channelContext = contextFor(input.acquisitionChannel);
  const opening = isContract
    ? `Recebi sua solicitação para avançar com o ${selection}. Antes de formalizarmos a contratação, quero validar a configuração escolhida e alinhar os próximos passos com o momento da ${input.company}.`
    : `Recebi sua solicitação e vi que você está avaliando o ${selection}. O contexto que compartilhou sobre a ${input.company} já nos dá um bom ponto de partida para a conversa.`;
  const goal = `O objetivo indicado foi: ${input.primaryGoal}.`;
  const transition = isContract
    ? 'Essa conversa é breve e evita que uma decisão importante comece com alguma premissa desalinhada.'
    : 'Em uma conversa breve, conseguimos transformar essas informações em um diagnóstico inicial e indicar o próximo passo mais coerente.';
  const question = 'Qual período funciona melhor para você: manhã ou tarde?';

  const text = [
    `Olá, ${input.firstName}.`,
    '',
    opening,
    '',
    goal,
    channelContext,
    '',
    transition,
    '',
    question,
    '',
    'Guilherme',
    'ORYNEO',
    'Crescimento em sistema.',
  ].join('\n');

  const safe = {
    firstName: escapeHtml(input.firstName),
    opening: escapeHtml(opening),
    goal: escapeHtml(goal),
    channelContext: escapeHtml(channelContext),
    transition: escapeHtml(transition),
    question: escapeHtml(question),
    preheader: escapeHtml(preheader),
    logoUrl: escapeHtml(input.logoUrl ?? '/oryneo-wordmark-mono.png'),
  };

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
  <body style="margin:0;padding:0;background:#F8F7F4;color:#0F1115;font-family:Inter,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safe.preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#F8F7F4;">
      <tr>
        <td align="center" class="email-outer" style="padding:32px 16px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:16px;overflow:hidden;">
            <tr><td style="height:5px;background:#4F6BFF;font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr>
              <td class="email-header" style="padding:36px 44px 14px;">
                <img src="${safe.logoUrl}" width="132" alt="ORYNEO" style="display:block;width:132px;max-width:100%;height:auto;border:0;">
              </td>
            </tr>
            <tr>
              <td class="email-content" style="padding:18px 44px 42px;font-size:16px;line-height:1.65;color:#0F1115;">
                <p style="margin:0 0 20px;">Olá, ${safe.firstName}.</p>
                <p style="margin:0 0 20px;">${safe.opening}</p>
                <p style="margin:0 0 8px;">${safe.goal}</p>
                <p style="margin:0 0 20px;">${safe.channelContext}</p>
                <p style="margin:0 0 20px;">${safe.transition}</p>
                <p style="margin:0 0 24px;font-weight:600;">${safe.question}</p>
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="border-radius:8px;background:#4F6BFF;">
                      <a href="mailto:contato@oryneo.com.br?subject=Re%3A%20${encodeURIComponent(subject)}" style="display:inline-block;padding:13px 20px;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;">Responder este e-mail</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:30px 0 0;color:#6B7280;font-size:14px;line-height:1.55;">Guilherme<br><strong style="color:#0F1115;">ORYNEO</strong><br>Crescimento em sistema.</p>
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
