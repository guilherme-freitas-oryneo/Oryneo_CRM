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
