/* ORYNEO Playbook: isolated Chrome/WebKit QA. The runner never calls production Supabase. */
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,copyFileSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,webkit} from 'playwright';

const root=process.cwd(),src=join(root,'src/playbook');
const paths=[
  join(root,'qa-playbook.html'),
  join(src,'playbook-qa-entry.tsx'),
  join(src,'PlaybookLibrary.QA.tsx'),
  join(src,'qa-mock-api.ts')
];
mkdirSync(join(root,'qa-results'),{recursive:true});
const original=readFileSync(join(src,'PlaybookLibrary.tsx'),'utf8');
if(!original.includes("from './api'")) throw Error('Missing API seam; cannot prove isolated test');
writeFileSync(paths[0],'<html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0"><div id="root"></div><script type="module" src="/src/playbook/playbook-qa-entry.tsx"></script></body></html>');
writeFileSync(paths[1],"import React from 'react';import{createRoot}from'react-dom/client';import{PlaybookLibrary}from './PlaybookLibrary.QA';createRoot(document.getElementById('root')!).render(<PlaybookLibrary/>);");
writeFileSync(paths[2],original.replace("from './api'","from './qa-mock-api'"));
copyFileSync(join(root,'.github/scripts/playbook-fixture-api.ts'),paths[3]);
let server;
async function boot(){
 for(let i=0;i<90;i++){try{const r=await fetch('http://127.0.0.1:4177/qa-playbook.html');if(r.ok)return}catch{}await delay(350)}
 throw Error('QA Vite server unavailable');
}
const cases=[
 ['chromium-desktop',chromium,{width:1440,height:900}],
 ['chromium-tablet',chromium,{width:1024,height:768}],
 ['chromium-mobile',chromium,{width:390,height:844}],
 ['webkit-mobile',webkit,{width:390,height:844}]
];
async function run(){
 server=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4177','--strictPort'],{cwd:root,stdio:['ignore','ignore','pipe']});
 server.stderr.on('data',s=>process.stderr.write(s));
 await boot();
 for(const [label,driver,viewport] of cases){
  const browser=await driver.launch({headless:true});
  const page=await browser.newPage({viewport,deviceScaleFactor:1});
  const exceptions=[],backend=[];
  page.on('pageerror',err=>exceptions.push(String(err)));
  page.on('request',req=>{if(req.url().includes('supabase.co'))backend.push(req.url())});
  try{
   await page.goto('http://127.0.0.1:4177/qa-playbook.html',{waitUntil:'networkidle'});
   await page.getByRole('button',{name:'Iniciar apresentação'}).waitFor();
   const logo=await page.locator('.pb-wait-header img').evaluate(el=>el.complete&&el.naturalWidth>0);
   if(!logo)throw Error(label+' official wordmark could not load');
   await page.screenshot({path:join(root,'qa-results',label+'-cover.png'),fullPage:true});
   await page.getByRole('button',{name:'Iniciar apresentação'}).click();
   await page.getByRole('heading',{name:'Venda com direção'}).waitFor();
   await page.screenshot({path:join(root,'qa-results',label+'-slide01.png'),fullPage:true});
   await page.getByRole('button',{name:'Próximo slide'}).click();
   await page.getByRole('heading',{name:'A proposta de valor'}).waitFor();
   await page.getByRole('button',{name:'Mostrar índice'}).click();
   const width=await page.evaluate(()=>({screen:window.innerWidth,page:document.documentElement.scrollWidth}));
   if(width.page>width.screen+4)throw Error(label+' unexpected horizontal page overflow: '+JSON.stringify(width));
   for(const [n,title,suffix] of [
     ['07','Três planos, uma lógica','pricing'],
     ['16','Situação: diagnóstico enxuto','spin'],
     ['47','Régua de contato','cadence'],
     ['64','Fontes e limites de uso','references']
   ]){
     await page.getByRole('button',{name:new RegExp('^'+n+'\\s')}).first().click();
     await page.getByRole('heading',{name:title}).waitFor();
     await page.screenshot({path:join(root,'qa-results',label+'-'+suffix+'.png'),fullPage:true});
   }
   await page.getByRole('heading',{name:'Biblioteca de referências'}).waitFor();
   await page.getByRole('button',{name:'Mostrar anotações'}).click();
   if(label==='chromium-desktop'||label==='chromium-mobile'){
    for(let i=1;i<=64;i++){
      const id=String(i).padStart(2,'0');
      await page.getByRole('button',{name:new RegExp('^'+id+'\\s')}).first().click();
      const layout=await page.evaluate(()=>{
       const slide=document.querySelector('.pb-slide');
       const footer=slide?.querySelector('.pb-slide-footer');
       const decision=slide?.querySelector('.pb-slide-end');
       if(!slide||!footer||!decision)return{missing:true};
       return{
         missing:false,
         overflow:slide.scrollHeight-slide.clientHeight,
         decisionPastFooter:decision.getBoundingClientRect().bottom>footer.getBoundingClientRect().top+2,
         horizontal:document.documentElement.scrollWidth-window.innerWidth
       }
      });
      if(layout.missing||layout.overflow>8||layout.decisionPastFooter||layout.horizontal>4){
       throw Error(label+' slide '+id+' clipped or overflowed: '+JSON.stringify(layout));
      }
    }
    console.log('PASS '+label+' — all 64 slides have decision and footer in bounds.');
   }
   await page.getByRole('button',{name:new RegExp('^64\\s')}).first().click();
   await page.getByRole('button',{name:/Anotar decisão deste slide/i}).click();
   await page.getByPlaceholder('O que vale lembrar ou aplicar?').fill('QA: anotação vinculada à seleção.');
   await page.getByRole('button',{name:'Salvar destaque'}).click();
   await page.getByText('QA: anotação vinculada à seleção.').waitFor();
   if(await page.locator('.pb-mark').count()===0)throw Error(label+' highlight failed');
   await page.getByRole('button',{name:'Editar anotação'}).click();
   await page.locator('.pb-note-edit textarea').fill('QA: anotação compartilhada.');
   await page.locator('.pb-note-edit select').selectOption('team');
   await page.locator('.pb-note-edit button').filter({hasText:'Salvar'}).click();
   await page.getByText('QA: anotação compartilhada.').waitFor();
   await page.screenshot({path:join(root,'qa-results',label+'-annotations.png'),fullPage:true});
   await page.getByRole('button',{name:'Excluir anotação'}).click();
   await page.getByText('Sem anotações neste slide.').waitFor();
   await page.getByRole('button',{name:'Reproduzir slides automaticamente'}).click();
   await page.getByRole('button',{name:'Pausar reprodução automática'}).waitFor();
   await page.getByRole('button',{name:'Pausar reprodução automática'}).click();
   await page.getByRole('button',{name:'Voltar ao início'}).click();
   await page.getByRole('button',{name:/Retomar no slide 64/}).waitFor();
   if(exceptions.length)throw Error(label+' browser exceptions '+exceptions.join(' | '));
   if(backend.length)throw Error(label+' production requests detected '+backend.join(' | '));
   console.log('PASS '+label+' — brand, slides, responsiveness, mark, notes, playback, resume.');
  }finally{await browser.close()}
 }
}
try{await run()}catch(e){console.error('PLAYBOOK_BROWSER_QA_FAILURE:',e);process.exitCode=1}finally{if(server)server.kill('SIGTERM');for(const p of paths)try{rmSync(p)}catch{}}
