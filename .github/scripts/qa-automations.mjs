import { chromium, webkit } from 'playwright';
import fs from 'node:fs';
const root = 'http://127.0.0.1:4173/Oryneo_CRM/';
const base = 'https://ucikrafwfzamxvweuvgk.supabase.co';
const userId = '77777777-7777-4777-8777-777777777777';
const workspaceId = '88888888-8888-4888-8888-888888888888';
const now = new Date().toISOString();
const exp = Math.floor(Date.now()/1000)+7200;
const token = [{alg:'HS256',typ:'JWT'},{sub:userId,email:'qa@example.com',role:'authenticated',aud:'authenticated',exp}].map(s=>Buffer.from(JSON.stringify(s)).toString('base64url')).join('.')+'.mock_signature';
const session = {access_token:token,token_type:'bearer',expires_in:7200,expires_at:exp,refresh_token:'mock',user:{id:userId,aud:'authenticated',role:'authenticated',email:'qa@example.com',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:now}};
const cases = [
  {engine:chromium,name:'chromium-desktop',width:1440,height:900,touch:false},
  {engine:chromium,name:'chromium-mobile',width:390,height:844,touch:true},
  {engine:chromium,name:'chromium-laptop',width:1024,height:768,touch:false},
  {engine:webkit,name:'webkit-tablet',width:768,height:1024,touch:true},
];
fs.mkdirSync('qa-results',{recursive:true});
for (const c of cases) {
  const browser = await c.engine.launch({headless:true});
  const page = await browser.newPage({viewport:{width:c.width,height:c.height},isMobile:c.touch,hasTouch:c.touch});
  const errors=[];
  const actions=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.addInitScript(({key,auth})=>localStorage.setItem(key,JSON.stringify(auth)),{key:'sb-ucikrafwfzamxvweuvgk-auth-token',auth:session});
  await page.route(base+'/**', async route=>{
    const req=route.request(),url=new URL(req.url());
    const path=url.pathname;
    const response=(payload,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(payload)});
    if(path.endsWith('/auth/v1/user'))return response(session.user);
    if(path.endsWith('/auth/v1/token'))return response(session);
    if(path.includes('/rest/v1/crm_records'))return response([]);
    if(path.includes('/rest/v1/crm_members'))return response([{user_id:userId}]);
    if(path.endsWith('/functions/v1/automation-api')){
      const input=JSON.parse(req.postData()||'{}');actions.push(input.action);
      if(input.action==='workspaces')return response({ok:true,workspaces:[{id:workspaceId,slug:'oryneo-crm',role:'admin',active:false}]});
      if(input.action==='list')return response({ok:true,flows:[]});
      if(input.action==='templates')return response({ok:true,templates:[]});
      if(input.action==='catalog')return response({ok:true,catalog:{stages:[],templates:[],knowledge:[],dictionaries:[]},readOnly:true});
      if(input.action==='executions')return response({ok:true,executions:[]});
      // PR #81 introduced a strictly read-only release matrix.
      // Model the real response contract, never claim ready or authorize send.
      if(input.action==='release-gates')return response({
        ok:true,readOnly:true,dispatchAuthorized:false,
        global:['RUNTIME_DISABLED','EMERGENCY_STOP'],
        channels:{
          crm:['OWNER_LEGACY'],email:['OWNER_LEGACY'],
          whatsapp:['OWNER_LEGACY'],onboarding:['OWNER_LEGACY'],
          billing:['OWNER_LEGACY'],
        },
        releaseReady:false,
        statement:'Aprovações documentais não ativam a engine nem autorizam envios.',
      });
      if(input.action==='commercial-readiness')return response({ok:true,readOnly:true,dispatchAuthorized:false,channels:['whatsapp','email','crm','onboarding','billing'].map(channel=>({channel,owner:'legacy',legacyPaused:false,releaseAttested:false,eligibleForControlledQueue:false})),runtime:{mode:'disabled',emergencyStop:true,workspaceActive:false}});
      if(input.action==='release-gates')return response({ok:true,readOnly:true,dispatchAuthorized:false,releaseReady:false,global:['legal','playbook','rollback','security','authenticated_e2e'],channels:{crm:['single_owner'],email:['single_owner'],whatsapp:['consent_policy'],onboarding:['single_owner'],billing:['financial_webhook']}});
      if(input.action==='sdr-semantic-list')return response({ok:true,readOnly:true,dispatchAuthorized:false,knowledge:[],dictionaries:[],selected:null,role:'admin'});
      if(input.action==='simulate')return response({ok:true,dryRun:true,simulationOnly:true,dispatchAuthorized:false,persisted:false,result:{shadowOnly:true,dispatchAuthorized:false,state:'completed',trace:[{nodeId:'77777777-7777-4777-8777-777777777777',type:'trigger',status:'evaluated'}],plannedActions:[],issues:[]}});
      if(input.action==='runtime')return response({ok:true,readOnly:true,runtime:{workspaceActive:false,mode:'disabled',emergencyStop:true,updatedAt:new Date().toISOString(),flows:0,publishedVersions:0,pendingEvents:0,executions:0,actionRows:0,waitingTimers:0,dueTimers:0,cancelledTimers:0,queuedActions:0,leasedActions:0,uncertainActions:0,sentActions:0,dispatchAuthorized:false}});
      if(input.action==='create')return response({ok:true,result:{id:input.graph.id,revision:1,versionId:'99999999-9999-4999-8999-999999999999'}},201);
      throw Error('Unexpected automation API action: '+input.action);
    }
    return response({error:'Mock route not available'},404);
  });
  try {
    const first=await page.goto(root,{waitUntil:'domcontentloaded',timeout:30000});
    if(first.status()!==200)throw Error('Page failed '+first.status());
    await page.getByRole('button',{name:'Automações',exact:true}).waitFor({timeout:15000});
    await page.getByRole('button',{name:'Automações',exact:true}).click();
    await page.getByRole('heading',{name:'Automações'}).waitFor({timeout:10000});
    await page.getByText('Motor em parada de emergência',{exact:true}).waitFor({timeout:10000});
    await page.getByRole('navigation',{name:'Áreas de automações'}).getByRole('button',{name:/Fluxos do pipeline/}).click();
    // Review variants add a CRM task but must remain non-emitting drafts.
    await page.getByRole('button',{name:/Nova oportunidade.*Revisão CRM/i}).click();
    await page.getByRole('textbox',{name:'Nome do fluxo'}).waitFor();
    await page.locator('.ory-auto-node').filter({hasText:'Tarefa interna de revisão'}).waitFor();
    if(!await page.getByTitle('Publicação disponível após engine homologada').isDisabled())
      throw Error('CRM review starter unexpectedly enabled publishing');
    await page.getByRole('button',{name:'Voltar à lista'}).click();
    // The original eight starter journeys remain unchanged zero-action drafts.
    await page.getByRole('button',{name:/Nova oportunidade.*Modelo editável/i}).click();
    const starterName=page.getByRole('textbox',{name:'Nome do fluxo'});
    await starterName.waitFor();
    if(await starterName.inputValue()!=='Nova oportunidade')
      throw Error('Canonical starter draft was not created');
    if(!await page.getByTitle('Publicação disponível após engine homologada').isDisabled())
      throw Error('A starter preset unexpectedly enabled publishing');
    await page.getByRole('button',{name:'Voltar à lista'}).click();
    await page.getByRole('button',{name:/Novo fluxo/i}).click();
    await page.getByRole('textbox',{name:'Nome do fluxo'}).waitFor();
    await page.getByTitle('Organizar nós automaticamente').click();
    await page.getByTitle('Desfazer').click();
    await page.getByTitle('Refazer').click();
    await page.getByRole('combobox',{name:'Cenário de simulação hipotética'})
      .selectOption('sdr_active');
    if(await page.getByRole('combobox',{name:'Cenário de simulação hipotética'}).inputValue()!=='sdr_active')
      throw Error('Hypothetical simulation scenario could not be selected');
    await page.getByTitle('Simular no servidor sem enviar').click();
    await page.getByText(/Simulação do servidor — nenhum envio/i).waitFor();
    await page.getByTitle('Simular sem efeitos externos').click();
    await page.getByText(/Simulação — não enviado/i).waitFor();
    const traced=await page.locator('.ory-auto-node.traced').count();
    const traceEdges=await page.locator('.ory-auto-canvas-scroll svg path.trace-path').count();
    if(traced!==2||traceEdges!==1)
      throw Error('Dry-run path did not match the two connected canvas nodes and one edge');

    if(!await page.getByTitle('Publicação disponível após engine homologada').isDisabled())throw Error('Unsafe activation enabled');
    await page.screenshot({path:'qa-results/oryneo-automations-'+c.name+'.png',fullPage:false});
    await page.getByRole('button',{name:'Salvar rascunho'}).click();
    await page.getByText(/Nenhum disparo executado/i).waitFor({timeout:10000});
    await page.getByRole('navigation',{name:'Áreas de automações'}).getByRole('button',{name:'Mais opções'}).click();
    await page.getByRole('navigation',{name:'Áreas de automações'}).getByRole('button',{name:/Templates e canais/}).click();
    await page.getByRole('heading',{name:'Templates e canais'}).waitFor();
    await page.getByRole('navigation',{name:'Áreas de automações'}).getByRole('button',{name:/Execuções e diagnóstico/}).click();
    await page.getByRole('heading',{name:'Execuções e diagnóstico'}).waitFor();
    const bodyWidth=await page.evaluate(()=>document.body.scrollWidth);
    if(bodyWidth>c.width+22)throw Error('Unexpected horizontal body overflow '+bodyWidth+'/'+c.width);
    if(errors.length)throw Error('Page errors '+errors.join(' | '));
    if(actions.some(x=>['send','execute','publish','publish-disabled'].includes(x)))throw Error('Unexpected effect action '+actions);
    if(!actions.includes('create'))throw Error('Draft persistence not invoked');
    console.log('AUTOMATIONS PASS',c.name,JSON.stringify({width:c.width,actionCount:actions.length,safeNoDispatch:true}));
  } finally {
    await browser.close();
  }
}
