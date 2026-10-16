import { describe, expect, it } from 'vitest';
import { renderFirstContactEmail, type FirstContactInput } from './firstContactTemplates';

const base: FirstContactInput = {
  intent: 'conversation',
  firstName: 'Rafael',
  company: 'Empresa X',
  plan: 'Growth',
  cycle: 'annual',
  addOns: ['landing-page', 'traffic'],
  goals: ['Atrair contatos com páginas e anúncios', 'Organizar contatos e negociações no CRM'],
  primaryGoal: 'Atrair contatos com páginas e anúncios',
  acquisitionChannels: ['Indicações e parcerias'],
  primaryAcquisitionChannel: 'Indicações e parcerias',
};

const channelGroups = [
  {
    id: 'single',
    acquisitionChannels: ['Google'],
    primaryAcquisitionChannel: 'Google',
    marker: 'busca, conversão e avanço comercial',
  },
  {
    id: 'two-three',
    acquisitionChannels: ['Indicações e parcerias', 'Instagram e Facebook', 'Google'],
    primaryAcquisitionChannel: 'Indicações e parcerias',
    marker: 'Também entram no contexto Instagram e Facebook e Google',
  },
  {
    id: 'four-plus',
    acquisitionChannels: ['Indicações e parcerias', 'Instagram e Facebook', 'Google', 'Prospecção ativa'],
    primaryAcquisitionChannel: 'Google',
    marker: 'diferentes frentes',
  },
  {
    id: 'unpredictable',
    acquisitionChannels: ['Ainda não temos um canal previsível'],
    primaryAcquisitionChannel: 'Ainda não temos um canal previsível',
    marker: 'primeiro processo de aquisição mensurável',
  },
] as const;

const commercialVariants = [
  { id: 'monthly-none', cycle: 'monthly', addOns: [] },
  { id: 'monthly-lp', cycle: 'monthly', addOns: ['landing-page'] },
  { id: 'monthly-both', cycle: 'monthly', addOns: ['landing-page', 'traffic'] },
  { id: 'annual-none', cycle: 'annual', addOns: [] },
  { id: 'annual-traffic', cycle: 'annual', addOns: ['traffic'] },
  { id: 'annual-both', cycle: 'annual', addOns: ['landing-page', 'traffic'] },
] as const;

const combinations = (['conversation', 'contract'] as const).flatMap((intent) =>
  channelGroups.flatMap((channel) =>
    commercialVariants.map((commercial) => ({ intent, channel, commercial })),
  ),
);

describe('renderFirstContactEmail', () => {
  it.each(combinations)('$intent · $channel.id · $commercial.id', ({ intent, channel, commercial }) => {
    const email = renderFirstContactEmail({
      ...base,
      intent,
      cycle: commercial.cycle,
      addOns: [...commercial.addOns],
      acquisitionChannels: [...channel.acquisitionChannels],
      primaryAcquisitionChannel: channel.primaryAcquisitionChannel,
    });

    expect(email.subject).toBe(intent === 'contract'
      ? 'Próximo passo da sua solicitação — ORYNEO'
      : 'Sua solicitação na ORYNEO');
    expect(email.text).toContain(channel.marker);
    expect(email.text).toContain('Atrair contatos com páginas e anúncios');
    expect(email.text).toContain(commercial.cycle === 'annual' ? 'ciclo anual' : 'ciclo mensal');
    expect(email.html).toContain(channel.marker);
    expect(email.html).toContain('href="https://wa.me/5521974510932"');
    expect(email.text).toContain('Conversar pelo WhatsApp: https://wa.me/5521974510932');
    expect(email.html).not.toContain('Responder este e-mail');
    expect(email.html).not.toMatch(/fonts\.googleapis|@font-face|oryneo-(?:y|wordmark-master|wordmark-color)/iu);
    expect(email.text).not.toMatch(/fundador|ceo|diretor|executiv/iu);
  });

  it('usa o canal legado quando a lista nova não existe', () => {
    const email = renderFirstContactEmail({
      ...base,
      acquisitionChannels: undefined,
      primaryAcquisitionChannel: undefined,
      acquisitionChannel: 'Loja física e eventos',
    });

    expect(email.text).toContain('contatos offline');
  });

  it('não inventa canal principal quando o valor é ausente ou inconsistente', () => {
    const missing = renderFirstContactEmail({
      ...base,
      acquisitionChannels: ['Google', 'Prospecção ativa'],
      primaryAcquisitionChannel: '',
    });
    const inconsistent = renderFirstContactEmail({
      ...base,
      acquisitionChannels: ['Google', 'Prospecção ativa'],
      primaryAcquisitionChannel: 'Instagram e Facebook',
    });

    expect(missing.text).toContain('Você indicou Google e Prospecção ativa');
    expect(inconsistent.text).toContain('Você indicou Google e Prospecção ativa');
    expect(`${missing.text}\n${inconsistent.text}`).not.toContain('canal principal');
  });

  it('escapa dados, remove controles e mantém HTML e texto semanticamente equivalentes', () => {
    const email = renderFirstContactEmail({
      ...base,
      firstName: '<Rafael>\r\nBcc: outra@empresa.com',
      company: 'A&B<script>',
      primaryGoal: 'Organizar <vendas> & marketing',
      goals: ['Organizar <vendas> & marketing'],
      logoUrl: 'https://cdn.oryneo.com.br/oryneo-wordmark-mono.png?x=1&y=2',
    });

    expect(email.html).toContain('&lt;Rafael&gt; Bcc: outra@empresa.com');
    expect(email.html).toContain('A&amp;B&lt;script&gt;');
    expect(email.html).toContain('Organizar &lt;vendas&gt; &amp; marketing');
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('https://cdn.oryneo.com.br/oryneo-wordmark-mono.png?x=1&amp;y=2');
    expect(email.text).not.toMatch(/<(?:html|body|p|table|a)\b/iu);
    for (const sentence of [
      'Olá, <Rafael> Bcc: outra@empresa.com.',
      'Organizar <vendas> & marketing',
      'Qual período funciona melhor para você: manhã ou tarde?',
      'Guilherme',
    ]) {
      expect(email.text).toContain(sentence);
      expect(email.html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).toContain(sentence);
    }
  });

  it('omite imagem quando não há URL e usa somente wordmark monocromático quando injetado', () => {
    const withoutLogo = renderFirstContactEmail(base);
    const withLogo = renderFirstContactEmail({ ...base, logoUrl: 'https://oryneo.com.br/assets/oryneo-wordmark-mono-reverse.png' });

    expect(withoutLogo.html).not.toContain('<img');
    expect(withLogo.html).toContain('<img');
    expect(withLogo.html).toContain('oryneo-wordmark-mono-reverse.png');
    expect(withLogo.html).toContain('alt="ORYNEO"');
  });

  it('diferencia contratação sem prometer venda concluída', () => {
    const email = renderFirstContactEmail({ ...base, intent: 'contract' });

    expect(email.text).toContain('Antes de formalizarmos a contratação');
    expect(email.text).toContain('validar a configuração escolhida');
    expect(email.text).not.toMatch(/contratação confirmada|bem-vindo como cliente/iu);
  });
});
