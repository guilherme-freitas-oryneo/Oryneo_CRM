import { useMemo, useState } from 'react';
import { renderFirstContactEmail } from '../mail/firstContactTemplates';
import { firstContactScenarios } from './fixtures';
import { renderTransactionalEmail, transactionScenarios, type TransactionalId, type TransactionalInput } from './transactionalTemplates';
import './emailPreview.css';

type Device = 'desktop' | 'mobile';
type Format = 'html' | 'text';
type Category = 'all' | 'commercial' | 'auth' | 'finance' | 'security';
type Scenario = { id:string;label:string;note:string;category:Exclude<Category,'all'> };

const sample:TransactionalInput = {
 firstName:'Marina',company:'Estúdio Aurora',email:'marina@empresa.example',
 newEmail:'marina.novo@empresa.example',plan:'Growth',cycle:'mensal',
 orderReference:'ORY-EXEMPLO-0001',amountCents:337970,renewalAmountCents:109990,
 supportEmail:'contato@oryneo.com.br',
 // URL demonstrativa: nenhum token/cobrança real é criado nesta biblioteca.
 actionUrl:'https://example.invalid/oryneo/acao-segura',
};

const commercial:Scenario[]=firstContactScenarios.map(s=>({
 id:s.id,label:s.label,note:s.note,category:'commercial'
}));
const transactional:Scenario[]=transactionScenarios.map(s=>({
 id:s.id,label:s.label,note:s.note,category:s.category
}));
const scenarios:Scenario[]=[...commercial,...transactional];

export function EmailPreviewGallery() {
 const [selectedId,setSelectedId]=useState<string>('confirm_email');
 const [category,setCategory]=useState<Category>('all');
 const [device,setDevice]=useState<Device>('desktop');
 const [format,setFormat]=useState<Format>('html');
 const list=category==='all'?scenarios:scenarios.filter(s=>s.category===category);
 const scenario=list.find(item=>item.id===selectedId)??list[0];
 const email=useMemo(()=>{
  const first=firstContactScenarios.find(s=>s.id===scenario.id);
  return first?renderFirstContactEmail(first.input)
   :renderTransactionalEmail(scenario.id as TransactionalId,sample);
 },[scenario]);
 const isSecurity=scenario.category==='auth'||scenario.category==='security';
 return (
  <main className="email-preview-app">
   <aside className="email-preview-sidebar">
    <div className="email-preview-brand">
     <img src="oryneo-wordmark-mono-reverse.png" alt="ORYNEO"/>
     <span>Laboratório de e-mails</span>
    </div>
    <div className="email-preview-heading">
     <span className="email-preview-kicker">Biblioteca · prévias</span>
     <h1>Comunicações ORYNEO</h1>
     <p>Identidade visual unificada. Conteúdo responsivo, texto simples e 12 modelos transacionais em prévia, além dos modelos comerciais existentes.</p>
    </div>
    <div className="email-preview-filter" aria-label="Filtrar modelos">
     {([
      ['all','Todos'],['auth','Ativação'],['security','Segurança'],['finance','Financeiro'],['commercial','Comercial']
     ] as const).map(([key,label])=>
      <button key={key} type="button" className={category===key?'is-active':''}
       aria-pressed={category===key} onClick={()=>setCategory(key)}>{label}</button>
     )}
    </div>
    <nav aria-label="Cenários de e-mail" className="email-preview-scenarios">
     {list.map((item,index)=>(
      <button type="button" key={item.id} className={item.id===scenario.id?'is-active':''}
       onClick={()=>setSelectedId(item.id)} aria-label={'Cenário '+(index+1)+': '+item.label}>
       <span>{item.label}</span><small>{item.note}</small>
      </button>
     ))}
    </nav>
    <p className="email-preview-disclaimer">Prévia demonstrativa: nenhum e-mail é disparado, nenhum token é gerado e nenhuma cobrança é processada aqui. A confirmação de acesso depende de controle de permissões e SMTP do Auth.</p>
   </aside>

   <section className="email-preview-workspace">
    <header className="email-preview-toolbar">
     <div>
      <span className="email-preview-label">{isSecurity?'Acesso & segurança':scenario.category==='finance'?'Cobrança & assinatura':'Relacionamento'} · <strong className="email-preview-label-muted">Prévia, não envio</strong></span>
      <strong>{email.subject}</strong>
      <small>Preheader: {email.preheader}</small>
      <small className="email-preview-meta">Remetente previsto: ORYNEO &lt;contato@oryneo.com.br&gt;</small>
     </div>
     <div className="email-preview-controls">
      <div className="email-preview-segment" aria-label="Formato">
       <button type="button" className={format==='html'?'is-active':''} onClick={()=>setFormat('html')}>HTML</button>
       <button type="button" className={format==='text'?'is-active':''} onClick={()=>setFormat('text')}>Texto simples</button>
      </div>
      <div className="email-preview-segment" aria-label="Dispositivo">
       <button type="button" className={device==='desktop'?'is-active':''} onClick={()=>setDevice('desktop')}>Desktop</button>
       <button type="button" className={device==='mobile'?'is-active':''} onClick={()=>setDevice('mobile')}>Mobile</button>
      </div>
     </div>
    </header>
    <div className="email-preview-stage">
     {format==='html'?
      <div data-testid="email-frame-shell" className={'email-frame-shell '+(device==='mobile'?'is-mobile':'')}>
       <iframe title={'Prévia de '+scenario.label} srcDoc={email.html} sandbox="allow-popups" referrerPolicy="no-referrer"/>
      </div>
      :<pre className={'email-text-preview '+(device==='mobile'?'is-mobile':'')}>{email.text}</pre>}
    </div>
   </section>
  </main>
 );
}
