import { describe, expect, it } from 'vitest';
import { sanitizeMailHtml } from './security';

describe('sanitizeMailHtml', () => {
  it('remove scripts, eventos, formulários e URLs executáveis', () => {
    const html = sanitizeMailHtml('<script>alert(1)</script><form><input></form><a href="javascript:alert(1)" onclick="x()">abrir</a>', false);
    expect(html).not.toMatch(/script|form|input|onclick|javascript:/i);
    expect(html).toContain('abrir');
  });

  it('bloqueia imagens remotas até consentimento e preserva a origem para liberação', () => {
    const blocked = sanitizeMailHtml('<img src="https://tracker.test/pixel.gif"><img src="data:image/png;base64,AA==">', false);
    expect(blocked).not.toMatch(/<img\s+src="https:\/\/tracker\.test/i);
    expect(blocked).toContain('data-remote-src="https://tracker.test/pixel.gif"');
    expect(blocked).toContain('data:image/png;base64,AA==');
    expect(sanitizeMailHtml('<img src="https://images.test/banner.png">', true)).toContain('src="https://images.test/banner.png"');
  });

  it('resolve CID apenas pelo mapa de anexos e endurece links externos', () => {
    const html = sanitizeMailHtml('<img src="cid:logo"><a href="https://example.com">site</a>', false, { logo: 'blob:https://crm.test/logo' });
    expect(html).toContain('src="blob:https://crm.test/logo"');
    expect(html).toContain('target="_blank"');
    expect(html).toMatch(/rel="[^"]*noopener[^"]*noreferrer|rel="[^"]*noreferrer[^"]*noopener/);
  });
});
