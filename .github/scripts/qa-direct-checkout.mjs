import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const root = 'http://127.0.0.1:4173/Oryneo_CRM/contratar/';
const supabase = 'https://ucikrafwfzamxvweuvgk.supabase.co/functions/v1/checkout-intake';
mkdirSync('qa-results', { recursive: true });

for (const [name, engine, viewport] of [
  ['checkout-desktop', chromium, { width: 1440, height: 960 }],
  ['checkout-mobile', chromium, { width: 390, height: 844 }],
  ['checkout-webkit', webkit, { width: 390, height: 844 }],
]) {
  const browser = await engine.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    const errors = [];
    let checkoutRequest;
    page.on('pageerror', error => errors.push(error.message));
    await page.route(supabase, async route => {
      checkoutRequest = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_qa_controlled' }) });
    });
    const response = await page.goto(root, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    await page.getByRole('heading', { name: 'Configure sua contratação.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Continuar para o pagamento' }).isDisabled(), true);
    await page.getByRole('radio', { name: /Plano Scale/i }).check();
    await page.getByRole('radio', { name: /Anual/i }).check();
    await page.getByRole('checkbox', { name: /Landing page de conversão/i }).check();
    await page.getByRole('checkbox', { name: /Gestão de tráfego pago/i }).check();
    await page.getByLabel('Nome completo').fill('Cliente de Homologação');
    await page.getByLabel('E-mail corporativo').fill('cliente.qa@example.invalid');
    await page.getByLabel('Empresa').fill('Oryneo QA Controlado');
    const action = page.getByRole('button', { name: 'Continuar para o pagamento' });
    const checkoutResponse = page.waitForResponse(response => response.url() === supabase && response.request().method() === 'POST');
    await action.click();
    await checkoutResponse;
    assert.equal(checkoutRequest.plan, 'Scale');
    assert.equal(checkoutRequest.cycle, 'annual');
    assert.deepEqual(checkoutRequest.addons, ['landing-page', 'traffic']);
    assert.equal(checkoutRequest.customer_email, 'cliente.qa@example.invalid');
    assert.match(checkoutRequest.request_id, /^[0-9a-f-]{36}$/i);
    assert.match(checkoutRequest.payment_token, /^[A-Za-z0-9_-]{43}$/);
    const stored = await page.evaluate(() => sessionStorage.getItem('oryneo.direct-checkout.request'));
    assert.ok(stored, 'a chave idempotente deve sobreviver a um retry na mesma sessão');
    assert.deepEqual(errors, []);
    const metrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(metrics.width <= metrics.viewport + 1, `overflow horizontal: ${JSON.stringify(metrics)}`);
    await page.screenshot({ path: `qa-results/${name}.png`, fullPage: false });
    console.log(`${name} OK: configuração, totais, payload seguro e responsividade`);
  } finally {
    await browser.close();
  }
}
