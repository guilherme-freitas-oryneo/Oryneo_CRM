import { describe, expect, it } from 'vitest';
import { formatMailDate, normalizeSubject, participantLabel } from './format';

describe('normalizeSubject', () => {
  it('remove prefixos encadeados de resposta e encaminhamento', () => {
    expect(normalizeSubject('  Re: FWD: RES: Enc:  Proposta   comercial ')).toBe('proposta comercial');
  });

  it('mantém o assunto útil e normaliza unicode', () => {
    expect(normalizeSubject('RE[2]:  Renovação – São Paulo')).toBe('renovacao – sao paulo');
  });
});

describe('participantLabel', () => {
  it('prefere o nome limpo', () => {
    expect(participantLabel({ name: '  Ana Silva ', address: 'ana@exemplo.com' })).toBe('Ana Silva');
  });

  it('usa a parte local do endereço quando não há nome', () => {
    expect(participantLabel({ address: 'contato@empresa.com.br' })).toBe('contato');
  });

  it('usa um rótulo seguro quando o participante é inválido', () => {
    expect(participantLabel({ address: '' })).toBe('Desconhecido');
  });
});

describe('formatMailDate', () => {
  const now = new Date('2026-10-12T18:00:00.000Z');

  it('mostra hora para mensagens de hoje', () => {
    expect(formatMailDate('2026-10-12T14:35:00.000Z', now)).toBe('14:35');
  });

  it('mostra dia e mês no mesmo ano', () => {
    expect(formatMailDate('2026-10-11T14:35:00.000Z', now)).toBe('11 out');
  });

  it('inclui o ano quando necessário e tolera datas inválidas', () => {
    expect(formatMailDate('2025-10-11T14:35:00.000Z', now)).toBe('11/10/2025');
    expect(formatMailDate('inválida', now)).toBe('—');
  });
});
