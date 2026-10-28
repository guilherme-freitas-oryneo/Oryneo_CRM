import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(`${process.cwd()}/src/billing/order-summary.css`, 'utf8');

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('contraste do resumo de cobrança', () => {
  it('mantém nomes e valores com contraste editorial no fundo claro', () => {
    expect(rule('.order-summary-items dt')).toMatch(/color:\s*#242931/i);
    expect(rule('.order-summary-items dd')).toMatch(/color:\s*#171a20/i);
  });

  it('mantém textos auxiliares e a recorrência legíveis, sem caixa interna', () => {
    expect(rule('.order-summary-items dt small')).toMatch(/color:\s*#6b7280/i);
    expect(rule('.order-summary-total span')).toMatch(/color:\s*#4c5560/i);
    expect(rule('.order-summary-recurring')).not.toMatch(/border:/i);
  });

  it('usa a família tipográfica e os neutrals oficiais da ORYNEO em um canvas contínuo', () => {
    expect(rule('.order-summary')).toMatch(/background:\s*transparent/i);
    expect(css).toMatch(/color:\s*#0f1115/i);
    expect(css).toMatch(/font-family:\s*Inter,\s*Arial,\s*sans-serif/i);
  });
});
