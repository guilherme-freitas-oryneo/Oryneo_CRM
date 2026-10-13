import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(`${process.cwd()}/src/billing/payment.css`, 'utf8');

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\{([^}]*)\\}`))?.[1] ?? '';
};

describe('contraste do resumo de cobrança', () => {
  it('define cores claras explicitamente nos nomes e valores dos itens', () => {
    expect(rule('.pay-items>div>span')).toMatch(/color:\s*#e7eaf0/i);
    expect(rule('.pay-items>div>strong')).toMatch(/color:\s*#f7f8fa/i);
  });

  it('mantém textos auxiliares legíveis sobre o card escuro', () => {
    expect(rule('.pay-items span small')).toMatch(/color:\s*#aeb5c0/i);
    expect(rule('.pay-total span')).toMatch(/color:\s*#b5bbc5/i);
    expect(rule('.pay-help')).toMatch(/color:\s*#a6adb8/i);
  });
});
