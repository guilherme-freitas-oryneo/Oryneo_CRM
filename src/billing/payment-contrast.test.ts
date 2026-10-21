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

  it('usa os tokens oficiais ORYNEO no fundo, CTA e tipografia do checkout', () => {
    expect(css).toMatch(/--oryneo-graphite:\s*#0f1115/i);
    expect(css).toMatch(/--oryneo-indigo:\s*#4f6bff/i);
    expect(css).toMatch(/--oryneo-off-white:\s*#f8f7f4/i);
    expect(css).toMatch(/--oryneo-cta:\s*#4357e8/i);
    expect(css).toMatch(/font-family:\s*Inter,\s*Arial,\s*sans-serif/i);
  });
});
