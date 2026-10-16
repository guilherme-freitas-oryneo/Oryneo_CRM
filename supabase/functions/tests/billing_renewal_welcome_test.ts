import { assert,assertEquals,assertMatch } from 'jsr:@std/assert@1';
import { buildBillingSelection } from '../_shared/billing/catalog.ts';
import {threeMonthsAfter,welcomeMarkup,TRAFFIC_QUARTERLY_PRICE} from '../_shared/billing/fulfillment.ts';

const plans=['Start','Growth','Scale'] as const;
const cycles=['monthly','annual'] as const;
const addOns=[[],['landing-page'],['traffic'],['landing-page','traffic']];
const base={Start:{monthly:74990,annual:809892,setup:98990},Growth:{monthly:109990,annual:1187892,setup:138990},
 Scale:{monthly:147990,annual:1598292,setup:184990}};
const additional={'landing-page':88990,traffic:296970};
Deno.test('24 combinações permanecem com seus preços homologados',()=>{
 let count=0;
 for(const plan of plans)for(const cycle of cycles)for(const addons of addOns){
  const quote=buildBillingSelection({plan,cycle,addons});
  const expected=base[plan][cycle]+base[plan].setup+
    addons.reduce((n,a)=>n+additional[a as keyof typeof additional],0);
  assertEquals(quote.amountTotal,expected);
  assertEquals(quote.items.length,2+addons.length);
  assertEquals(quote.items.reduce((total,item)=>total+item.amountCents,0),expected);
  assertEquals(quote.items[0].recurring,true);
  assertEquals(quote.items[1].recurring,false);
  if(addons.includes('traffic')){
   const selected=quote.items.find(item=>item.key==='traffic');
   assertEquals(selected?.amountCents,296970);
   assertEquals(selected?.recurring,false); // Primeiros 3 meses continuam cobrança única no Checkout.
   assertEquals(quote.trafficRenewalPriceId,TRAFFIC_QUARTERLY_PRICE);
  }else assertEquals(quote.trafficRenewalPriceId,null);
  count++;
 }
 assertEquals(count,24);
});
Deno.test('renovação é em meses-calendário e preserva virada do último dia',()=>{
 assertEquals(new Date(threeMonthsAfter('2026-10-31T16:30:00Z')*1000).toISOString(),'2027-01-31T16:30:00.000Z');
 assertEquals(new Date(threeMonthsAfter('2026-01-31T10:00:00Z')*1000).toISOString(),'2026-04-30T10:00:00.000Z');
 assertEquals(new Date(threeMonthsAfter('2026-11-30T13:20:00Z')*1000).toISOString(),'2027-02-28T13:20:00.000Z');
});
const sample={
 id:'00000000-0000-4000-8000-000000000001',
 reference:'ORY-EXEMPLO',customer_name:'Marina Costa',company:'Acme & Filhos',
 customer_email:'marina@example.com',status:'paid',paid_at:'2026-10-13T20:00:00Z',
 stripe_customer_id:'cus_example',stripe_subscription_id:'sub_example',stripe_traffic_subscription_id:null,
 amount_total:634940,
 selection:{plan:'Growth',cycle:'monthly',addons:['landing-page','traffic']},
 items:[
 {key:'growth_monthly',label:'Plano Growth',detail:'Assinatura mensal',amount_cents:109990},
 {key:'growth_setup',label:'Implantação',detail:'Única',amount_cents:138990},
 {key:'landing-page',label:'Landing page',detail:'Única',amount_cents:88990},
 {key:'traffic',label:'Gestão de tráfego',detail:'Primeiros 3 meses antecipados',amount_cents:296970},
 ],
};
Deno.test('e-mail inclui itens adquiridos, assinatura e escapa HTML',()=>{
 const data=welcomeMarkup(sample);
 assertMatch(data.subject,/Marina/);
 assertMatch(data.text,/trimestre/);
 assertMatch(data.text,/6.349,40/);
 assert(data.html.includes('Acme &amp; Filhos'));
 assert(data.html.includes('src="https://oryneo.com.br/assets/oryneo-wordmark-mono-reverse.png"'));
 assert(data.html.includes('alt="ORYNEO"'));
 assert(!data.html.includes('letter-spacing:3px">ORYNEO'));
 assert(data.html.includes('R$'));
});
Deno.test('e-mail não exibe complementos ausentes',()=>{
 const order={...sample,selection:{plan:'Start',cycle:'annual',addons:[]},amount_total:908882,
 items:[
 {key:'start_annual',label:'Plano Start',detail:'Assinatura anual antecipada',amount_cents:809892},
 {key:'start_setup',label:'Implantação',detail:'Única',amount_cents:98990}
 ]};
 const email=welcomeMarkup(order);
 assert(!email.text.includes('Tráfego:'));
 assert(!email.text.includes('Landing page incluída'));
 assertMatch(email.text,/por ano/);
});
