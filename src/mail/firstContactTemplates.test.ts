import { describe, expect, it } from 'vitest';
import { renderFirstContactEmail, type FirstContactInput } from './firstContactTemplates';

const base: FirstContactInput = {
  intent: 'conversation',
  firstName: 'Rafael',
  company: 'Empresa X',
  plan: 'Growth',
  cycle: 'annual',
  addOns: ['landing-page', 'traffic'],
  primaryGoal: 'Atrair contatos com páginas e anúncios',
  acquisitionChannel: 'Indicações e parcerias',
};

describe('renderFirstContactEmail', () => {
  it('gera a abordagem consultiva sem posicionamento executivo', () => {
    const email = renderFirstContactEmail(base);

    expect(email.subject).toBe('Sua solicitação na ORYNEO');
    expect(email.text).toContain('Olá, Rafael.');
    expect(email.text).toContain('plano Growth, no ciclo anual, com landing page de conversão e gestão de tráfego pago');
    expect(email.text).toContain('Qual período funciona melhor para você: manhã ou tarde?');
    expect(`${email.subject}\n${email.text}`).not.toMatch(/fundador|ceo|diretor|executiv/iu);
  });

  it('diferencia contratação de conversa sem prometer uma venda concluída', () => {
    const email = renderFirstContactEmail({ ...base, intent: 'contract' });

    expect(email.subject).toBe('Próximo passo da sua solicitação — ORYNEO');
    expect(email.text).toContain('Antes de formalizarmos a contratação');
    expect(email.text).toContain('validar a configuração escolhida');
    expect(email.text).not.toMatch(/contratação confirmada|bem-vindo como cliente/iu);
  });

  it.each([
    ['Indicações e parcerias', 'preservar essa força'],
    ['Instagram e Facebook', 'captados, atendidos e acompanhados'],
    ['Google', 'busca, conversão e avanço comercial'],
    ['Prospecção ativa', 'cadência atual'],
    ['Portais e marketplaces', 'diferentes origens dentro de um fluxo único'],
    ['Loja física e eventos', 'contatos offline'],
    ['Ainda não temos um canal previsível', 'primeiro processo de aquisição mensurável'],
    ['Outro canal', 'entender o fluxo atual'],
  ] as const)('contextualiza o canal %s', (acquisitionChannel, expected) => {
    const email = renderFirstContactEmail({ ...base, acquisitionChannel });
    expect(email.text).toContain(expected);
  });

  it('omite complementos quando somente o plano foi selecionado', () => {
    const email = renderFirstContactEmail({ ...base, cycle: 'monthly', addOns: [] });

    expect(email.text).toContain('plano Growth, no ciclo mensal.');
    expect(email.text).not.toContain('landing page');
    expect(email.text).not.toContain('tráfego pago');
  });

  it('escapa dados do lead e usa o wordmark oficial totalmente monocromático', () => {
    const email = renderFirstContactEmail({ ...base, firstName: '<Rafael>', company: 'A&B' });

    expect(email.html).toContain('&lt;Rafael&gt;');
    expect(email.html).toContain('A&amp;B');
    expect(email.html).not.toContain('<Rafael>');
    expect(email.html).toContain('oryneo-wordmark-mono.png');
    expect(email.html).not.toContain('oryneo-wordmark-master.png');
    expect(email.html).not.toContain('oryneo-wordmark.png');
    expect(email.html).toContain('alt="ORYNEO"');
    expect(email.html).toContain('#0F1115');
    expect(email.html).toContain('#4F6BFF');
    expect(email.html).toContain('#F8F7F4');
    expect(email.html).toContain('@media screen and (max-width: 480px)');
  });

  it('entrega texto simples equivalente e sem marcação HTML', () => {
    const email = renderFirstContactEmail(base);

    expect(email.preheader).toContain('Empresa X');
    expect(email.text).toContain('Guilherme\nORYNEO\nCrescimento em sistema.');
    expect(email.text).not.toMatch(/<\/?[a-z][^>]*>/iu);
  });
});
