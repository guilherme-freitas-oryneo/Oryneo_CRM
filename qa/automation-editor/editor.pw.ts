import {test,expect} from '@playwright/test';

const sizes=[
 {width:390,height:844},{width:768,height:1024},
 {width:1024,height:768},{width:1440,height:900},
];
for(const viewport of sizes){
 test('ORYNEO editor Pipeline renderiza e edita em '+viewport.width+'px',async({page})=>{
  await page.setViewportSize(viewport);
  await page.goto('/qa/automation-editor/index.html');
  await page.getByRole('button',{name:'Fluxos do pipeline'}).click();
  await page.getByRole('button',{name:/Novo fluxo/}).first().click();
  await expect(page.getByRole('region',{name:'Canvas visual do pipeline'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Editar nó Gatilho inicial'})).toBeVisible();
  await expect(page.getByTitle('Publicação disponível após engine homologada')).toBeDisabled();
  await page.getByRole('button',{name:'Adicionar bloco Condição'}).click();
  await expect(page.getByRole('button',{name:'Editar nó Condição'})).toBeVisible();
  await page.getByTitle('Simular sem efeitos externos').click();
  await expect(page.getByText(/Simulação — não enviado/)).toBeVisible();
  const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,view:window.innerWidth}));
  expect(width.scroll,'No unintended horizontal document overflow').toBeLessThanOrEqual(width.view+5);
  await page.screenshot({path:'qa/automation-editor/artifacts/pipeline-'+viewport.width+'.png',fullPage:true});
 });
 test('ORYNEO SDR: canvas, palette, painel e touch em '+viewport.width+'px',async({page})=>{
  await page.setViewportSize(viewport);
  await page.goto('/qa/automation-editor/index.html');
  await page.getByRole('button',{name:'Fluxos do SDR'}).click();
  await page.getByRole('button',{name:/Novo fluxo/}).first().click();
  await expect(page.getByRole('region',{name:'Canvas visual do SDR'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Adicionar bloco Classificação de intenção'})).toBeVisible();
  await page.getByRole('button',{name:'Adicionar bloco Classificação de intenção'}).click();
  await expect(page.getByRole('button',{name:'Editar nó Classificação de intenção'})).toBeVisible();
  await page.getByRole('button',{name:'Menu do nó Classificação de intenção'}).click();
  await expect(page.getByRole('button',{name:'Duplicar nó'})).toBeVisible();
  await page.getByRole('button',{name:'Fechar menu'}).click();
  await page.getByTitle('Alternar inspetor').click();
  await expect(page.getByTitle('Alternar inspetor')).toHaveAttribute('aria-pressed','false');
  await page.getByTitle('Alternar inspetor').click();
  await page.screenshot({path:'qa/automation-editor/artifacts/sdr-'+viewport.width+'.png',fullPage:true});
 });
}
test('conexão e undo/redo preservam port IDs sem disparos',async({page})=>{
 await page.goto('/qa/automation-editor/index.html');
 await page.getByRole('button',{name:'Fluxos do pipeline'}).click();
 await page.getByRole('button',{name:/Novo fluxo/}).first().click();
 const lines=page.locator('.ory-auto-edge-add');
 await expect(lines).toHaveCount(1);
 await lines.first().click();
 await page.getByRole('button',{name:'Adicionar bloco Condição'}).click();
 await expect(page.getByRole('button',{name:'Editar nó Condição'})).toBeVisible();
 await expect(lines).toHaveCount(2);
 await page.getByTitle('Desfazer').click();
 await expect(lines).toHaveCount(1);
 await page.getByTitle('Refazer').click();
 await expect(lines).toHaveCount(2);
 await expect(page.getByTitle('Publicação disponível após engine homologada')).toBeDisabled();
});

test('arrastar bloco e conectar handle cria aresta tipada no mesmo grafo',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/qa/automation-editor/index.html');
 await page.getByRole('button',{name:'Fluxos do pipeline'}).click();
 await page.getByRole('button',{name:/Novo fluxo/}).first().click();
 const canvas=page.getByRole('region',{name:'Canvas visual do pipeline'});
 const palette=page.getByRole('button',{name:'Adicionar bloco Condição'});
 await palette.dragTo(canvas,{targetPosition:{x:430,y:240}});
 await expect(page.getByRole('button',{name:'Editar nó Condição'})).toBeVisible();
 await page.getByRole('button',{name:'Conectar saída yes do nó Condição'})
   .dragTo(page.getByRole('button',{name:'Editar nó Fim'}));
 await expect(page.locator('.ory-auto-edge-add')).toHaveCount(2);
 await expect(page.getByTitle('Publicação disponível após engine homologada')).toBeDisabled();
});

test('salvar e reabrir novo rascunho mantém nós e conexões sem acionar provedores',async({page})=>{
 await page.goto('/qa/automation-editor/index.html');
 await page.getByRole('button',{name:'Fluxos do SDR'}).click();
 await page.getByRole('button',{name:/Novo fluxo/}).first().click();
 await page.getByRole('button',{name:'Adicionar bloco Classificação de intenção'}).click();
 await page.getByRole('button',{name:'Salvar rascunho'}).click();
 await expect(page.getByText('Cópia de segurança salva neste navegador.')).toBeVisible();
 await page.getByRole('button',{name:'Voltar à lista'}).click();
 await page.getByRole('button',{name:/Novo fluxo SDR/}).first().click();
 await expect(page.getByRole('button',{name:'Editar nó Classificação de intenção'})).toBeVisible();
 await expect(page.getByTitle('Publicação disponível após engine homologada')).toBeDisabled();
});

test('E01: arrastar nó conectado preserva aresta visual e posição após salvar/reabrir',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/qa/automation-editor/index.html');
 await page.getByRole('button',{name:'Fluxos do pipeline'}).click();
 await page.getByRole('button',{name:/Novo fluxo/}).first().click();
 const trigger=page.getByRole('button',{name:'Editar nó Gatilho inicial'});
 const box=await trigger.boundingBox();
 if(!box)throw Error('Node was not laid out');
 await page.mouse.move(box.x+55,box.y+38);
 await page.mouse.down();
 await page.mouse.move(box.x+160,box.y+62,{steps:10});
 await page.mouse.up();
 const moved=page.locator('.ory-auto-node').filter({has:trigger});
 await expect(moved).not.toHaveCSS('left','100px');
 await expect(page.locator('.ory-auto-edge-add')).toHaveCount(1);
 await page.getByRole('button',{name:'Salvar rascunho'}).click();
 await page.getByRole('button',{name:'Voltar à lista'}).click();
 await page.getByRole('button',{name:/Novo fluxo do pipeline/}).first().click();
 await expect(page.locator('.ory-auto-node').filter({has:page.getByRole('button',{name:'Editar nó Gatilho inicial'})})).not.toHaveCSS('left','100px');
 await expect(page.locator('.ory-auto-edge-add')).toHaveCount(1);
});
test('E06: três condições, mesmas IDs/portas/valores após reload do navegador',async({page})=>{
 await page.goto('/qa/automation-editor/index.html');
 await page.getByRole('button',{name:'Fluxos do pipeline'}).click();
 await page.getByRole('button',{name:/Novo fluxo/}).first().click();
 await page.getByRole('button',{name:'Adicionar bloco Condição'}).click();
 await page.getByRole('button',{name:'Adicionar bloco Condição'}).click();
 await page.getByRole('button',{name:'Adicionar bloco Condição'}).click();
 await expect(page.getByRole('button',{name:'Editar nó Condição'})).toHaveCount(3);
 await page.getByRole('button',{name:'Salvar rascunho'}).click();
 const prior=await page.evaluate(()=>localStorage.getItem('oryneo:automations:draft:qa-visual-editor-no-backend'));
 expect(prior).toContain('"type":"condition"');
 await page.reload();
 await page.getByRole('button',{name:'Fluxos do pipeline'}).click();
 await page.getByRole('button',{name:/Novo fluxo do pipeline/}).first().click();
 await expect(page.getByRole('button',{name:'Editar nó Condição'})).toHaveCount(3);
 const after=await page.evaluate(()=>localStorage.getItem('oryneo:automations:draft:qa-visual-editor-no-backend'));
 expect(after).toBe(prior);
 await expect(page.getByTitle('Publicação disponível após engine homologada')).toBeDisabled();
});

for(const width of [390,1440]){
  test('Stage3: integrações comerciais somente leitura em '+width+'px',async({page})=>{
    await page.setViewportSize({width,height:844});
    await page.goto('/qa/automation-editor/index.html');
    await page.getByRole('button',{name:/Templates e canais/}).click();
    await expect(page.getByRole('region',{
      name:'Proprietários das integrações comerciais'
    })).toBeVisible();
    await expect(page.getByText(/Nenhum disparo está autorizado por esta tela/)).toBeVisible();
    await expect(page.getByRole('button',{name:/Habilitar canal|Enviar mensagem|Iniciar cobrança/})).toHaveCount(0);
    await page.screenshot({
      path:'qa/automation-editor/artifacts/commercial-readiness-'+width+'.png',
      fullPage:true,
    });
  });
}
