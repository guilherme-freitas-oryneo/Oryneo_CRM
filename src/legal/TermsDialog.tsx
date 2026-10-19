import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { BookOpenText, X } from 'lucide-react';
import './terms-dialog.css';

const TERMS_URL = `${import.meta.env.BASE_URL}legal/oryneo-termos-v0.9-homologacao.txt`;

export function TermsDialog({ label='Consultar termos completos' }: {label?:string}) {
  const [open,setOpen]=useState(false);
  const [source,setSource]=useState<string|null>(null);
  const [error,setError]=useState(false);
  useEffect(()=>{
    if(!open||source!==null)return;
    const abort=new AbortController();
    setError(false);
    void fetch(TERMS_URL,{signal:abort.signal,cache:'no-store'})
      .then(async response=>{
        if(!response.ok)throw new Error('DOCUMENT_UNAVAILABLE');
        const text=await response.text();
        if(!text.includes('TERMOS GERAIS DE CONTRATAÇÃO')||!text.includes('ANEXO III'))throw new Error('DOCUMENT_INVALID');
        if(!abort.signal.aborted)setSource(text);
      }).catch(()=>{if(!abort.signal.aborted)setError(true)});
    return()=>abort.abort();
  },[open,source]);
  const paragraphs=source?.split(/\n\s*\n/g).map(p=>p.trim()).filter(Boolean)||[];
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button type='button' className='oryneo-terms-trigger'><BookOpenText size={15} aria-hidden='true'/>{label}</button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className='oryneo-terms-overlay'/>
      <Dialog.Content className='oryneo-terms-modal' aria-describedby='oryneo-terms-description'>
        <header className='oryneo-terms-header'>
          <div><span className='oryneo-terms-eyebrow'>ORYNEO · DOCUMENTAÇÃO</span><Dialog.Title>Termos Gerais de Contratação e Uso</Dialog.Title><Dialog.Description id='oryneo-terms-description'>Minuta v0.9 para homologação de leitura; não é uma versão contratual definitiva.</Dialog.Description></div>
          <Dialog.Close asChild><button type='button' className='oryneo-terms-close' aria-label='Fechar termos'><X size={22}/></button></Dialog.Close>
        </header>
        <div className='oryneo-terms-notice' role='note'>Minuta em homologação. A confirmação comercial do pedido é independente desta prévia.</div>
        <div className='oryneo-terms-body' tabIndex={0} aria-label='Conteúdo integral dos termos'>
          {error?<p role='alert'>Não foi possível carregar a íntegra dos termos. Feche e abra novamente para tentar.</p>
            :source===null?<p role='status'>Carregando minuta contratual…</p>
            :<article>{paragraphs.map((t,i)=>i===0?<h2 key={i}>{t}</h2>:/^(?:\d+\.\s|ANEXO [IVX]+)/.test(t)?<h3 key={i}>{t}</h3>:<p key={i}>{t}</p>)}</article>}
        </div>
        <footer className='oryneo-terms-footer'>
          <a href={TERMS_URL} download='oryneo-termos-v0.9-homologacao.txt'>Salvar minuta</a>
          <Dialog.Close asChild><button type='button' className='oryneo-terms-return'>Voltar à contratação</button></Dialog.Close>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
