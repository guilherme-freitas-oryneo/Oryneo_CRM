import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';

/** Browser QA is fully mocked: no live Stripe API requests or charges. */
const root='http://127.0.0.1:4173/Oryneo_CRM/pagar/';
const api='https://ucikrafwfzamxvweuvgk.supabase.co/functions/v1/billing-public';
const pixCode='00020101021226890014br.gov.bcb.pix5204000053039865802BR6304TEST';
const mockQrUrl='https://qr.stripe.com/oryneo-qa-simulated.png';
const mockQrSvg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 248 248"><rect width="248" height="248" fill="white"/><rect x="10" y="10" width="55" height="55" fill="#0F1115"/><rect x="183" y="10" width="55" height="55" fill="#0F1115"/><rect x="10" y="183" width="55" height="55" fill="#0F1115"/><text x="124" y="132" font-size="17" text-anchor="middle" fill="#4357E8">PIX QA</text></svg>';
const order={reference:'ORY-QA-PIX',company:'Empresa de Homologação',customer_name:'Cliente de Teste',status:'awaiting_payment',payment_method:'pix',card_funding:null,currency:'brl',amount_total:173980,items:[{key:'start',label:'Plano Start',detail:'Assinatura mensal',amount_cents:74990},{key:'setup',label:'Implantação',detail:'Cobrança única',amount_cents:98990}],recurring:{label:'Plano Start',amount_cents:74990,interval_label:'por mês'},expires_at:'2030-10-22T18:00:00Z',test_mode:true};
mkdirSync('qa-results',{recursive:true});
const browsers=[
 ['pix-qr-desktop',chromium,{width:1440,height:960}],
 ['pix-qr-mobile',chromium,{width:390,height:844}],
 ['pix-qr-webkit',webkit,{width:390,height:844}]
].filter(([name])=>process.env.ORYNEO_SKIP_WEBKIT !== '1'||name!=='pix-qr-webkit');
for(const [name,engine,viewport] of browsers){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport,isMobile:viewport.width<500,hasTouch:viewport.width<500});
  const errors=[];const actions=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(mockQrUrl,route=>route.fulfill({status:200,contentType:'image/svg+xml',body:mockQrSvg}));
  await page.route(api,async route=>{
    if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,OPTIONS'}});
    const body=JSON.parse(route.request().postData()||'{}');actions.push(body.action);
    if(body.action!=='read')throw Error('Tentativa inesperada de escrita no fluxo Pix de QA');
    return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({
       order,pix:{status:'ready',copy_paste:pixCode,qr_code_url:mockQrUrl,expires_at:'2030-10-22T18:00:00Z'},client_secret:null,publishable_key:null
    })});
  });
  const response=await page.goto(root+'?token='+'q'.repeat(48),{waitUntil:'domcontentloaded'});
  assert.equal(response?.status(),200);
  await page.getByRole('heading',{name:/Pague R\$\s*1\.739,80 com Pix/}).waitFor();
  const panel=page.getByRole('region',{name:'QR Code e Pix Copia e Cola'});
  await panel.waitFor();
  const qr=panel.getByAltText('QR Code Pix deste pedido, gerado pela Stripe');
  await qr.waitFor();
  await assert.doesNotReject(async()=>await qr.evaluate(img=>new Promise((resolve,reject)=>{
    if(img.complete)return img.naturalWidth>0?resolve():reject(Error('QR image not loaded'));
    img.onload=()=>resolve();img.onerror=()=>reject(Error('QR image load failed'));
  })));
  assert.equal(await panel.getByRole('textbox',{name:'Código Pix Copia e Cola'}).inputValue(),pixCode);
  assert.equal(await panel.getByRole('button',{name:'Copiar código'}).isEnabled(),true);
  assert.equal(await page.getByText(/Um código QR será exibido/i).count(),0);
  assert.equal(await page.getByText(/Pagamento não concluído/i).count(),0);
  assert.equal(await page.getByRole('checkbox').count(),0);
  assert.equal(await page.getByRole('button',{name:/Tentar gerar Pix novamente/i}).count(),0);
  assert.deepEqual(actions,['read'],'Apenas consulta de QR preexistente, sem criar cobrança');
  assert.deepEqual(errors,[]);
  const dims=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth}));
  assert.ok(dims.width<=dims.viewport+1,'Overflow horizontal: '+JSON.stringify(dims));
  await page.screenshot({path:`qa-results/${name}.png`,fullPage:true});
  console.log(`${name} OK: QR e Pix Copia e Cola imediatos, sem aceite ou cobrança, responsivo [MOCK QA]`);
 }finally{await browser.close();}
}
