import { chromium, webkit } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = 'http://127.0.0.1:4173/Oryneo_CRM/';
const contrast = (foreground, background) => {
  const luminance = color => {
    const rgb = color.match(/\d+/g)?.slice(0, 3).map(Number);
    assert.equal(rgb?.length, 3, `cor inesperada: ${color}`);
    const channels = rgb.map(value => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
const approvedAssets = [
  ['public/oryneo-y.svg', 'ba92ee6eb89d9cff08321e07d13a497e998a790dfa6c7b4d6ffc6c309759cfff'],
  ['public/oryneo-wordmark-master.png', 'a27039b50b2984352d4b92dcdf6332514c267595254bc66a28b393e35fbd28ef'],
];
for (const [file, expected] of approvedAssets) {
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  assert.equal(actual, expected, `${file} difere do Brand Kit homologado`);
}

mkdirSync('qa-results', { recursive: true });
const browsers = [
  ['chromium-desktop', chromium, { width: 1440, height: 900 }],
  ['chromium-mobile', chromium, { width: 320, height: 720 }],
  ['chromium-zoom200', chromium, { width: 720, height: 450 }],
];
if (process.env.ORYNEO_SKIP_WEBKIT !== '1') browsers.push(['webkit-mobile', webkit, { width: 320, height: 720 }]);
for (const [name, engine, viewport] of browsers) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://ucikrafwfzamxvweuvgk.supabase.co/**', async route => {
      if (route.request().url().includes('/auth/v1/token')) {
        await new Promise(resolve => setTimeout(resolve, 150));
        return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 'invalid_credentials', msg: 'Invalid login credentials' }) });
      }
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    const response = await page.goto(root, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    assert.match(await page.locator('link[rel="icon"]').getAttribute('href'), /oryneo-y\.svg$/, 'favicon deve usar o Y isolado');
    await page.getByRole('button', { name: 'Entrar no CRM' }).waitFor();
    const brand = await page.locator('.login-wordmark').getAttribute('src');
    assert.match(brand, /oryneo-wordmark-master\.png$/);
    const mark = await page.locator('.login-mark').getAttribute('src');
    assert.match(mark, /oryneo-y\.svg$/);
    assert.equal(await page.locator('.login-mark').evaluate(img => img.naturalWidth > 0), true);
    if (viewport.width > 760) {
      const storyColor = await page.locator('.login-story').evaluate(el => getComputedStyle(el).backgroundColor);
      const rgb = storyColor.match(/\d+/g).map(Number);
      assert.ok(rgb.every(c => c >= 210), `painel ainda escuro: ${storyColor}`);
    }
    const footerColor = await page.locator('.login-form footer').evaluate(el => getComputedStyle(el).color);
    assert.ok(contrast(footerColor, 'rgb(255, 255, 255)') >= 4.5, 'texto do rodapé deve ter contraste AA sobre branco');
    const metrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(metrics.width <= metrics.viewport + 1, `overflow horizontal: ${JSON.stringify(metrics)}`);
    const button = await page.getByRole('button', { name: 'Entrar no CRM' }).boundingBox();
    if (name !== 'chromium-zoom200') assert.ok(button && button.y + button.height <= viewport.height, 'ação principal fora do primeiro viewport');
    assert.equal(await page.getByRole('textbox', { name: 'E-mail' }).getAttribute('autocomplete'), 'username');
    assert.equal(await page.locator('input[name=password]').getAttribute('autocomplete'), 'current-password');
    await page.getByRole('button', { name: 'Mostrar senha' }).click();
    assert.equal(await page.locator('input[name=password]').getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Ocultar senha' }).click();
    assert.equal(await page.locator('input[name=password]').getAttribute('type'), 'password');
    await page.screenshot({ path: `qa-results/login-${name}-idle.png` });
    await page.getByRole('textbox', { name: 'E-mail' }).fill('qa@example.com');
    await page.locator('input[name=password]').fill('senha-qa');
    await page.getByRole('button', { name: 'Entrar no CRM' }).click();
    assert.equal(await page.getByRole('button', { name: /Entrando/ }).isDisabled(), true, 'submit deve ficar indisponível durante o login');
    const alert = page.getByRole('alert');
    await alert.waitFor();
    assert.match(await alert.innerText(), /Não foi possível entrar/);
    assert.doesNotMatch(await alert.innerText(), /existe|não existe/i);
    assert.equal(await alert.evaluate(el => document.activeElement === el), true, 'erro deve receber foco');
    await page.screenshot({ path: `qa-results/login-${name}-error.png` });
    assert.deepEqual(errors, []);
    console.log(`${name} OK: marca oficial, layout, formulário e erro neutro`);
  } finally {
    await browser.close();
  }
}
