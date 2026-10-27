import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';

/**
 * QA independente: não acessa nem cria pedidos reais.
 * Executa a UI vigente com backend Supabase interceptado integralmente.
 */
const prefix='http://127.0.0.1:4173/Oryneo_CRM/';
const root=prefix+'contratar/';
const supabasePrefix='https://ucikrafwfzamxvweuvgk.supabase.co/';
const demoToken='q'.repeat(43);
const paymentUrl=prefix+'pagar/?token='+demoToken;
mkdirSync('qa-results',{recursive:true});

const browsers=[
  ['checkout-desktop',chromium,{width:1440,height:960}],
  ['checkout-mobile',chromium,{width:390,height:844}],
  ['checkout-webkit',webkit,{width:390,height:844}],
].filter(([name])=>process.env.ORYNEO_SKIP_WEBKIT !== '1'||name!=='checkout-webkit');

for(const [name,engine,viewport] of browsers){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport,isMobile:viewport.width<500,hasTouch:viewport.width<500});
  const errors=[],actions=[];
  let checkoutRequest=null;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(supabasePrefix+'**',async route=>{
    const request=route.request();
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,OPTIONS'};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
    const url=request.url();
    const body=JSON.parse(request.postData()||'{}');
    if(url.endsWith('/functions/v1/checkout-intake')){
      actions.push(body.action);
      if(body.action==='draft'){
        return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({cnpj_status:'found',company:{legal_name:'ORYNEO QA Ltda.',trade_name:'ORYNEO QA'}})});
      }
      if(body.action==='checkout'){
        checkoutRequest=body;
        return route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({url:paymentUrl})});
      }
      throw Error('Ação inesperada no endpoint checkout-intake do teste: '+body.action);
    }
    // Não deixar a página de pagamento subsequente acessar backend de produção.
    if(url.endsWith('/functions/v1/billing-public'))
      return route.fulfill({status:503,headers,contentType:'application/json',body:'{"error":"QA_PAYMENT_NOT_EXECUTED"}'});
    return route.fulfill({status:404,headers,contentType:'application/json',body:'{}'});
  });
  const response=await page.goto(root+'?plan=Scale&cycle=annual',{waitUntil:'domcontentloaded'});
  assert.equal(response?.status(),200);
  await page.getByRole('heading',{name:'Revise e conclua.'}).waitFor();
  const selection=page.getByRole('region',{name:'Plano e periodicidade selecionados'});
  assert.match(await selection.innerText(),/ORYNEO Scale/);
  assert.match(await selection.innerText(),/Anual/);
  assert.equal(await page.locator('.checkout-payment-options input[type="radio"]').count(),3);
  assert.equal(await page.getByRole('radiogroup',{name:'Tipo do cartão'}).count(),0,'Crédito e débito ficam ocultos sem selecionar cartão');
  await page.getByRole('radio',{name:'Cartão',exact:true}).check();
  assert.equal(await page.getByRole('radiogroup',{name:'Tipo do cartão'}).getByRole('radio').count(),2,'Cartão contém crédito e débito após a escolha');
  await page.getByRole('radio',{name:'Pix',exact:true}).check();
  assert.equal(await page.getByRole('radiogroup',{name:'Tipo do cartão'}).count(),0,'Subopções somem ao selecionar Pix');
  assert.equal(await page.getByText('Seu pagamento via Pix').count(),0,'Sem etapa redundante de Pix');
  const marks=page.locator('.checkout-payment-art img');
  assert.equal(await marks.count(),2,'As imagens Pix e boleto são as únicas na seleção; cartão usa SVG');
  assert.equal(await page.locator('.checkout-card-art svg').count(),1,'Cartão tem ícone vetorial acessível');
  await page.waitForFunction(()=>[...document.querySelectorAll('.checkout-payment-art img')].every(img=>img.complete),null,{timeout:12000});
  const logoDetails=await marks.evaluateAll(images=>images.map(img=>({loaded:img.complete,width:img.naturalWidth,srcPrefix:img.src.slice(0,22)})));
  assert.ok(logoDetails.every(img=>img.loaded&&img.width>0&&img.srcPrefix==='data:image/png;base64,'),'Símbolos do Pix e boleto devem usar assets PNG locais homologados');
  const cards=page.locator('.checkout-payment-options>label');
  assert.equal(await cards.count(),3);
  await page.getByRole('checkbox',{name:/Landing page de conversão/i}).check();
  await page.getByRole('checkbox',{name:/Gestão de tráfego pago/i}).check();
  await page.getByLabel('Nome completo').fill('Cliente de Homologação');
  await page.getByLabel('E-mail',{exact:true}).fill('cliente.qa@example.invalid');
  await page.getByLabel('WhatsApp').fill('21987654321');
  await page.getByLabel('CNPJ').fill('11222333000181');
  const action=page.getByRole('button',{name:/Continuar para o Pix/});
  assert.equal(await action.isDisabled(),true,'Aceite e CNPJ verificado são obrigatórios');
  await page.getByText('Empresa identificada: ORYNEO QA').waitFor({timeout:15000});
  assert.equal(await action.isDisabled(),true,'Aceite comercial ainda obrigatório');
  await page.getByRole('checkbox',{name:/Li e aceito os termos/}).check();
  assert.equal(await action.isEnabled(),true);
  await page.screenshot({path:`qa-results/${name}.png`,fullPage:true});
  const responsePromise=page.waitForResponse(r=>r.url().endsWith('/functions/v1/checkout-intake')&&r.request().method()==='POST'&&JSON.parse(r.request().postData()||'{}').action==='checkout');
  await action.click();
  await responsePromise;
  await page.waitForURL(/\/pagar\/\?token=/,{timeout:12000});
  assert.ok(actions.includes('draft')&&actions.includes('checkout'),'Deve salvar prévia e preparar apenas via backend simulado');
  assert.equal(checkoutRequest.plan,'Scale');
  assert.equal(checkoutRequest.cycle,'annual');
  assert.deepEqual(checkoutRequest.addons,['landing-page','traffic']);
  assert.equal(checkoutRequest.customer_email,'cliente.qa@example.invalid');
  assert.equal(checkoutRequest.cnpj,'11222333000181');
  assert.equal(checkoutRequest.customer_phone,'+5521987654321');
  assert.equal(checkoutRequest.payment_method,'pix');
  assert.equal(checkoutRequest.card_funding,null);
  assert.match(checkoutRequest.request_id,/^[0-9a-f-]{36}$/i);
  assert.match(checkoutRequest.payment_token,/^[A-Za-z0-9_-]{43}$/);
  const stored=await page.evaluate(()=>sessionStorage.getItem('oryneo.direct-checkout.request'));
  assert.ok(stored,'Idempotência persiste na sessão');
  assert.deepEqual(errors,[],'Sem exceções JavaScript não tratadas');
  const metrics=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert.ok(metrics.width<=metrics.viewport+1,'Overflow horizontal: '+JSON.stringify(metrics));
  console.log(`${name} OK: cartão condicional, CNPJ, WhatsApp, Pix, termos e checkout simulado, sem cobrança real`);
 }finally{
  await browser.close();
 }
}
