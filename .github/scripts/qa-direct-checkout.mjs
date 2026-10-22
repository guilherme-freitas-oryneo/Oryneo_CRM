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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: `${root}#checkout-qa-controlado` }) });
    });
    const response = await page.goto(root + '?plan=Scale&cycle=annual', { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    await page.getByRole('heading', { name: 'Revise sua contratação.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Continuar para o pagamento/ }).isDisabled(), true);
    const selection=page.getByRole('region', { name: 'Plano e periodicidade selecionados' });
    assert.match(await selection.innerText(), /ORYNEO Scale/);
    assert.match(await selection.innerText(), /Anual/);
    assert.equal(await page.getByRole('radio').count(), 4, 'As quatro opções são meios de pagamento; plano e ciclo permanecem bloqueados');
    await page.getByRole('radio', { name: /Pix/ }).check();
    assert.equal(await page.getByText('Seu pagamento via Pix').count(), 0, 'Não apresentar etapa explicativa redundante do Pix');
    const marks=page.locator('.checkout-payment-art img');
    assert.equal(await marks.count(),6,'Visa/Mastercard em ambos os cartões, Pix e boleto');
    const logoReady=await marks.evaluateAll(images=>images.every(img=>img instanceof HTMLImageElement && img.complete && img.naturalWidth>0 && img.src.startsWith('data:image/png;base64,')));
    assert.equal(logoReady,true,'os quatro símbolos aprovados devem carregar localmente');
    const maxCardHeight=await page.locator('.checkout-payment-options>label').evaluateAll(items=>Math.max(...items.map(item=>item.getBoundingClientRect().height)));
    assert.ok(maxCardHeight<=96,`cards altos demais: ${maxCardHeight}px`);
    assert.equal(await page.getByText('Seu pagamento via Pix').count(),0);
    await page.getByRole('checkbox', { name: /Landing page de conversão/i }).check();
    await page.getByRole('checkbox', { name: /Gestão de tráfego pago/i }).check();
    await page.getByLabel('Nome completo').fill('Cliente de Homologação');
    await page.getByLabel('E-mail corporativo').fill('cliente.qa@example.invalid');
    await page.getByLabel('Empresa').fill('Oryneo QA Controlado');
    await page.getByLabel('CPF ou CNPJ').fill('52998224725');
    const action = page.getByRole('button', { name: /Continuar para o Pix/ });
    assert.equal(await action.isDisabled(), true, 'O aceite da primeira tela é obrigatório');
    await page.getByRole('checkbox', { name: /Li e aceito os termos/ }).check();
    assert.equal(await action.isEnabled(), true);
    await page.screenshot({ path: `qa-results/${name}.png`, fullPage: true });
    const checkoutResponse = page.waitForResponse(response => response.url() === supabase && response.request().method() === 'POST');
    const returnedToCheckout = page.waitForURL(`${root}#checkout-qa-controlado`);
    await action.click();
    await checkoutResponse;
    await returnedToCheckout;
    assert.equal(checkoutRequest.plan, 'Scale');
    assert.equal(checkoutRequest.cycle, 'annual');
    assert.deepEqual(checkoutRequest.addons, ['landing-page', 'traffic']);
    assert.equal(checkoutRequest.customer_email, 'cliente.qa@example.invalid');
    assert.equal(checkoutRequest.tax_id, '52998224725');
    assert.equal(checkoutRequest.payment_method, 'pix');
    assert.match(checkoutRequest.request_id, /^[0-9a-f-]{36}$/i);
    assert.match(checkoutRequest.payment_token, /^[A-Za-z0-9_-]{43}$/);
    const stored = await page.evaluate(() => sessionStorage.getItem('oryneo.direct-checkout.request'));
    assert.ok(stored, 'a chave idempotente deve sobreviver a um retry na mesma sessão');
    assert.deepEqual(errors, []);
    const metrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(metrics.width <= metrics.viewport + 1, `overflow horizontal: ${JSON.stringify(metrics)}`);
    console.log(`${name} OK: seleção imutável, adicionais, payload seguro e responsividade`);
  } finally {
    await browser.close();
  }
}
