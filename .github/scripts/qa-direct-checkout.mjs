import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';

const root = 'http://127.0.0.1:4173/Oryneo_CRM/contratar/';
const supabase = 'https://ucikrafwfzamxvweuvgk.supabase.co/functions/v1/checkout-intake';
mkdirSync('qa-results', { recursive: true });

const browsers = [
  ['checkout-desktop', chromium, { width: 1440, height: 960 }],
  ['checkout-mobile', chromium, { width: 390, height: 844 }],
  ['checkout-webkit', webkit, { width: 390, height: 844 }],
].filter(([name]) => process.env.ORYNEO_SKIP_WEBKIT !== '1' || name !== 'checkout-webkit');

for (const [name, engine, viewport] of browsers) {
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
    await page.getByRole('heading', { name: 'Revise e conclua.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Continuar para o pagamento/ }).isDisabled(), true);
    const selection=page.getByRole('region', { name: 'Plano e periodicidade selecionados' });
    assert.match(await selection.innerText(), /ORYNEO Scale/);
    assert.match(await selection.innerText(), /Anual/);
    assert.equal(await page.locator('.checkout-payment-options input[type="radio"]').count(), 3, 'Cartão, boleto e Pix são as únicas formas de pagamento');
    // Verificar a condição após selecionar cartão; não pressupor modalidade inicial.
    await page.getByRole('radio', { name: /Cartão/i }).check();
    assert.equal(await page.getByRole('radiogroup', { name: 'Tipo do cartão' }).getByRole('radio').count(), 2, 'Crédito e débito aparecem condicionados ao cartão');
    await page.getByRole('radio', { name: /Pix/ }).check();
    assert.equal(await page.getByRole('radiogroup', { name: 'Tipo do cartão' }).count(), 0, 'Crédito e débito somem fora do cartão');
    assert.equal(await page.getByText('Seu pagamento via Pix').count(), 0, 'Não apresentar etapa explicativa redundante do Pix');
    const marks=page.locator('.checkout-payment-art img');
    assert.equal(await marks.count(), 2, 'A interface atual usa dois PNGs oficiais: Pix e boleto; cartão é ícone SVG.');
    assert.equal(await page.locator('.checkout-card-art svg').count(), 1, 'O símbolo do cartão deve ser exibido uma vez.');
    await page.waitForFunction(()=>[...document.querySelectorAll('.checkout-payment-art img')].every(img=>img.complete),null,{timeout:12000});
    const logoDetails=await marks.evaluateAll(images=>images.map(img=>({loaded:img.complete,width:img.naturalWidth,srcPrefix:img.src.slice(0,22)})));
    assert.ok(logoDetails.every(img=>img.loaded && img.width>0 && img.srcPrefix==='data:image/png;base64,'),`os símbolos aprovados precisam carregar: ${JSON.stringify(logoDetails)}`);
    const maxCardHeight=await page.locator('.checkout-payment-options>label').evaluateAll(items=>Math.max(...items.map(item=>item.getBoundingClientRect().height)));
    assert.ok(maxCardHeight<=96,`cards altos demais: ${maxCardHeight}px`);
    console.log(`${name}: 2 PNGs aprovados e 1 símbolo SVG de cartão; cartão mais alto ${Math.round(maxCardHeight)}px`);
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
