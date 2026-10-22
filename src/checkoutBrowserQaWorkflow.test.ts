import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('gate de navegador do checkout', () => {
  it('preserva Chromium e WebKit com margem para oscilações do espelho de pacotes', () => {
    const workflow = read('.github/workflows/qa-crm-v21.yml');

    expect(workflow).toContain('timeout-minutes: 30');
    expect(workflow).toContain('run: npx playwright install --with-deps chromium webkit');
    expect(workflow).not.toContain("ORYNEO_SKIP_WEBKIT: '1'");
  });

  it.each([
    '.github/scripts/qa-login-brand.mjs',
    '.github/scripts/qa-direct-checkout.mjs',
    '.github/scripts/qa-pix-generated.mjs',
    '.github/scripts/qa-crm-v21.mjs',
  ])('%s respeita a matriz Chromium do gate rápido', path => {
    expect(read(path)).toContain("process.env.ORYNEO_SKIP_WEBKIT !== '1'");
  });
});
