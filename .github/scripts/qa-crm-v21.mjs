import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
const root='http://127.0.0.1:4173/Oryneo_CRM/';
const supabaseBase='https://ucikrafwfzamxvweuvgk.supabase.co';
const userId='77777777-7777-4777-8777-777777777777';
const stageId='11111111-1111-4111-8111-111111111111';
const now=new Date().toISOString();
const sample=(id,company,done)=>({
 id,kind:'deal',revision:1,deleted:false,created_at:now,updated_at:now,
 data:{
  title:'Solicitação · '+company,company,contact:'Contato de teste',email:'contato@example.com',phone:'(21) 99999-0000',
  value_cents:337970,stage_id:stageId,source:'Landing page',notes:'',due_date:'',
  next_action:{title:'Realizar diagnóstico inicial',done,due_at:null},
  form_submission:{team_size:'Mais de 20 pessoas',acquisition_channel:'Outro canal',intent:'contract',goals:['Organizar contatos e negociações no CRM','Acompanhar resultados e gestão']},
  quote:{plan:'Growth',cycle:'monthly',monthly_cents:109990,period_cents:109990,setup_cents:138990,first_charge_cents:337970,users:10,catalog_version:'test',addons:[{key:'landing-page',label:'Landing page de conversão',billing:'one_time',amount_cents:88990,upfront_cents:88990}]},
  company_cnpj:null
 }
});
const createRows=()=>[
 {id:stageId,kind:'stage',revision:1,deleted:false,created_at:now,updated_at:now,data:{name:'Aproximação',color:'#4F80C2',outcome:'open',position:1000}},
 sample('22222222-2222-4222-8222-222222222222','Empresa QA Ltda.',false),
 sample('33333333-3333-4333-8333-333333333333','Segunda Empresa QA Ltda.',true)
];
fs.mkdirSync('qa-results',{recursive:true});
for(const [engine,name] of [[chromium,'chromium'],[chromium,'chromium-mobile'],[webkit,'webkit']].filter(([,name])=>process.env.ORYNEO_SKIP_WEBKIT!=='1'||name!=='webkit')){
 const browser=await engine.launch({headless:true});
 const mobile=name!=='chromium';
 const page=await browser.newPage({viewport:{width:mobile?390:1440,height:900},isMobile:mobile,hasTouch:mobile});
 let rows=createRows(),rpcCount=0;
 const exp=Math.floor(Date.now()/1000)+7200;
 const fakeJwt=[{alg:'HS256',typ:'JWT'},{sub:userId,email:'qa@example.com',role:'authenticated',aud:'authenticated',exp}].map(o=>Buffer.from(JSON.stringify(o)).toString('base64url')).join('.')+'.mock_signature';
 const session={access_token:fakeJwt,token_type:'bearer',expires_in:7200,expires_at:exp,refresh_token:'mock-refresh',user:{id:userId,aud:'authenticated',role:'authenticated',email:'qa@example.com',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],created_at:now}};
 await page.addInitScript(({key,auth})=>{localStorage.setItem(key,JSON.stringify(auth))},{key:'sb-ucikrafwfzamxvweuvgk-auth-token',auth:session});
 await page.route(supabaseBase+'/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
  const respond=(body,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(body)});
  if(path.endsWith('/auth/v1/user'))return respond(session.user);
  if(path.endsWith('/auth/v1/token'))return respond(session);
  if(path.includes('/rest/v1/crm_members'))return respond([{user_id:userId}]);
  if(path.includes('/rest/v1/crm_records'))return respond(rows);
  if(path.includes('/rest/v1/crm_companies'))return respond([]);
  if(path.includes('/rest/v1/crm_events'))return respond([]);
  if(path.includes('/rest/v1/rpc/crm_set_action')&&method==='POST'){
   rpcCount++;
   const input=JSON.parse(req.postData()||'{}');
   const record=rows.find(r=>r.id===input.p_deal_id);
   if(!record)return respond({message:'deal not found'},404);
   if(input.p_revision!==record.revision)return respond({message:'revision conflict'},409);
   record.data.next_action={title:input.p_title,due_at:input.p_due_at,done:input.p_done};
   record.revision++;
   return respond('44444444-4444-4444-8444-444444444444');
  }
  return respond({message:'QA mock: rota inesperada '+path},404);
 });
 const errors=[];const requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push('console:'+m.text())});page.on('requestfailed',r=>requests.push('FAILED '+r.url()+' '+r.failure()?.errorText));page.on('response',r=>{if(r.status()>=400)requests.push('HTTP '+r.status()+' '+r.url())});
 const response=await page.goto(root,{waitUntil:'domcontentloaded',timeout:30000});
 if(response.status()!==200)throw Error(name+' status '+response.status());
 await page.waitForTimeout(1800);
 console.log(name+' INIT:',JSON.stringify({body:(await page.locator('body').innerText()).slice(0,1100),root:await page.evaluate(()=>document.getElementById('root')?.innerHTML.slice(0,900)),scripts:await page.evaluate(()=>[...document.querySelectorAll('script')].map(x=>x.src)),title:await page.title(),errors,requests,storage:await page.evaluate(()=>Object.keys(localStorage))}));
 await page.screenshot({path:'qa-results/'+name+'-init.png'});
 await page.getByRole('heading',{name:/Pipeline comercial/}).waitFor({timeout:7000});
 if(mobile && !(await page.locator('.brand-image img').evaluate(img=>img.currentSrc.endsWith('/oryneo-y.svg'))))throw Error('marca compacta não usa Y oficial');
 await page.locator('.sidebar').getByRole('button',{name:/Atividades/}).click();
 await page.getByRole('heading',{name:'Atividades'}).waitFor({timeout:10000});
 if(await page.locator('.activity-entry').count()!==2)throw Error(name+' lista inicial incorreta');
 await page.getByRole('tab',{name:/Sem prazo/}).click();
 if(await page.locator('.activity-entry').count()!==1)throw Error(name+' filtro sem prazo incorreto');
 await page.getByRole('tab',{name:/Todas/}).click();
 await page.locator('.activity-entry-title').first().click();
 await page.getByText('Diagnóstico inicial',{exact:true}).waitFor({timeout:10000});
 await page.getByText('Mais de 20 pessoas',{exact:true}).waitFor();
 await page.getByText('Organizar contatos e negociações no CRM',{exact:true}).waitFor();
 await page.screenshot({path:'qa-results/'+name+'-diagnostico.png',fullPage:false});
 await page.locator('.cd-top').getByRole('button',{name:'Fechar ficha'}).click();
 await page.locator('.activity-secondary').first().click();
 await page.locator('.activity-modal-body input').first().fill('Retornar proposta comercial');
 await page.locator('.activity-modal-body input[type="datetime-local"]').fill('2026-10-12T14:00');
 await page.getByRole('button',{name:'Salvar atividade'}).click();
 await page.getByText('Atividade salva e registrada no histórico.').waitFor({timeout:15000});
 if(rpcCount!==1)throw Error(name+' RPC foi chamada '+rpcCount+' vezes');
 const img=await page.evaluate(async()=>{
  const res=await fetch('oryneo-wordmark.png',{cache:'no-store'});
  return {status:res.status,type:res.headers.get('content-type'),bytes:(await res.arrayBuffer()).byteLength};
 });
 if(img.status!==200||img.bytes<50000)throw Error(name+' wordmark invalido '+JSON.stringify(img));
 await page.screenshot({path:'qa-results/'+name+'-atividades.png',fullPage:false});
 if(errors.length)throw Error(name+' JS errors '+JSON.stringify(errors));
 console.log(name+' OK: dashboard, filtros, diagnóstico, RPC de atividade, asset do Drive. Wordmark bytes='+img.bytes);
 await browser.close();
}
