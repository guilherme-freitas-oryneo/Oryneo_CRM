import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

describe('Composer', () => {
  it('normaliza destinatários e envia com chave idempotente', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<Composer mailboxId="mailbox-1" onClose={vi.fn()} onSend={onSend} />);
    await userEvent.type(screen.getByLabelText('Para'), 'Cliente <cliente@exemplo.com>');
    await userEvent.type(screen.getByLabelText('Assunto'), 'Proposta');
    await userEvent.type(screen.getByLabelText('Mensagem'), 'Olá, segue a proposta.');
    await userEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toMatchObject({
      mailboxId: 'mailbox-1', subject: 'Proposta', text: 'Olá, segue a proposta.',
      to: [{ name: 'Cliente', address: 'cliente@exemplo.com' }],
    });
    expect(onSend.mock.calls[0][0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('impede envio sem destinatário', async () => {
    const onSend = vi.fn();
    render(<Composer mailboxId="mailbox-1" onClose={vi.fn()} onSend={onSend} />);
    await userEvent.click(screen.getByRole('button', { name: /^enviar$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe pelo menos um destinatário');
    expect(onSend).not.toHaveBeenCalled();
  });
});

 it('recusa lista parcialmente inválida sem descartar destinatários', async () => {
   const onSend = vi.fn();
   render(<Composer mailboxId="box" onClose={vi.fn()} onSend={onSend}/>);
   await userEvent.type(screen.getByLabelText('Para'), 'ana@example.com; inválido');
   await userEvent.click(screen.getByRole('button', {name:/^enviar$/i}));
   expect(onSend).not.toHaveBeenCalled();
   expect(screen.getByRole('alert')).toHaveTextContent(/destinatário/i);
 });
 it('reutiliza a mesma chave ao repetir um envio que falhou', async () => {
   const onSend=vi.fn().mockRejectedValueOnce(new Error('Rede indisponível')).mockResolvedValue(undefined);
   render(<Composer mailboxId="box" onClose={vi.fn()} onSend={onSend}/>);
   await userEvent.type(screen.getByLabelText('Para'),'ana@example.com');
   await userEvent.click(screen.getByRole('button',{name:/^enviar$/i}));
   await screen.findByRole('alert');
   await userEvent.click(screen.getByRole('button',{name:/enviar|tentar novamente/i}));
   expect(onSend).toHaveBeenCalledTimes(2);
   expect(onSend.mock.calls[0][0].idempotencyKey).toBe(onSend.mock.calls[1][0].idempotencyKey);
 });
 it('aceita imagem colada e arquivos arrastados', async () => {
   render(<Composer mailboxId="box" onClose={vi.fn()} onSend={vi.fn()}/>);
   const image=new File(['img'],'imagem.png',{type:'image/png'});
   fireEvent.paste(screen.getByLabelText('Mensagem'), {clipboardData:{items:[{kind:'file',type:'image/png',getAsFile:()=>image}]}});
   expect(screen.getByText(/imagem.png/)).toBeInTheDocument();
   fireEvent.drop(screen.getByRole('dialog'),{dataTransfer:{files:[new File(['pdf'],'proposta.pdf',{type:'application/pdf'})],types:['Files']}});
   expect(screen.getByText(/proposta.pdf/)).toBeInTheDocument();
 });
 it('salva texto e bytes de anexos antes de fechar',async()=>{
   const onSaveDraft=vi.fn(async(_draft: import('./Composer').DraftSnapshot)=>({revision:1})),onClose=vi.fn();
   render(<Composer mailboxId="box" onClose={onClose} onSend={vi.fn()} onSaveDraft={onSaveDraft}/>);
   await userEvent.type(screen.getByLabelText('Assunto'),'Rascunho preservado');
   fireEvent.drop(screen.getByRole('dialog'),{dataTransfer:{files:[new File(['conteudo'],'nota.txt',{type:'text/plain'})],types:['Files']}});
   await userEvent.click(screen.getByRole('button',{name:'Salvar e fechar composição'}));
   await waitFor(()=>expect(onClose).toHaveBeenCalledOnce(),{timeout:5000});
   expect(onSaveDraft.mock.calls[0][0]).toMatchObject({subject:'Rascunho preservado',attachments:[{filename:'nota.txt',contentBase64:btoa('conteudo')}]});
 });

 it('salva tentativa imutável antes do SMTP e não altera revisão no retry',async()=>{
   const onSaveDraft=vi.fn(async(draft:import('./Composer').DraftSnapshot)=>({revision:draft.revision+1}));
   const onSend=vi.fn().mockRejectedValueOnce(new Error('Rede indisponível')).mockResolvedValue(undefined);
   render(<Composer mailboxId="box" onClose={vi.fn()} onSend={onSend} onSaveDraft={onSaveDraft}/>);
   await userEvent.type(screen.getByLabelText('Para'),'ana@example.com');
   await userEvent.type(screen.getByLabelText('Mensagem'),'Conteúdo');
   await userEvent.click(screen.getByRole('button',{name:/^enviar$/i}));
   expect(await screen.findByRole('alert')).toHaveTextContent('Rede indisponível');
   expect(onSaveDraft).toHaveBeenCalledTimes(2);
   expect(onSaveDraft.mock.calls[0][0]).toMatchObject({revision:0,locked:false});
   expect(onSaveDraft.mock.calls[1][0]).toMatchObject({revision:1,locked:true});
   await userEvent.click(screen.getByRole('button',{name:/tentar novamente/i}));
   await screen.findByText(/Tentativa de envio protegida/);
   expect(onSaveDraft).toHaveBeenCalledTimes(2);
   expect(onSend).toHaveBeenCalledTimes(2);
   expect(onSend.mock.calls[0][0]).toEqual(onSend.mock.calls[1][0]);
 });

 it('reescreve uma tentativa só após descarte seguro no servidor',async()=>{
   vi.spyOn(window,'confirm').mockReturnValue(true);
   const onRestart=vi.fn(),onDiscardDraft=vi.fn().mockResolvedValue(undefined);
   render(<Composer mailboxId="box" initialDraft={{id:'draft-old',revision:2,to:'ana@example.com',cc:'',bcc:'',subject:'Corrigir',text:'Corpo',attachments:[],locked:true}} onClose={vi.fn()} onSend={vi.fn()} onDiscardDraft={onDiscardDraft} onRestart={onRestart}/>);
   await userEvent.click(screen.getByRole('button',{name:'Reescrever tentativa'}));
   await waitFor(()=>expect(onRestart).toHaveBeenCalledOnce());
   expect(onDiscardDraft).toHaveBeenCalledWith('draft-old');
   expect(onRestart.mock.calls[0][0]).toMatchObject({revision:0,to:'ana@example.com',subject:'Corrigir',locked:false});
   expect(onRestart.mock.calls[0][0].id).not.toBe('draft-old');
   vi.restoreAllMocks();
 });

 it('bloqueia nova tentativa quando o aceite SMTP é incerto',async()=>{
   vi.spyOn(window,'confirm').mockReturnValue(true);
   const onRestart=vi.fn(),onDiscardDraft=vi.fn().mockRejectedValue(new Error('MAIL_IN_PROGRESS'));
   render(<Composer mailboxId="box" initialDraft={{id:'draft-old',revision:2,to:'ana@example.com',cc:'',bcc:'',subject:'Corrigir',text:'Corpo',attachments:[],locked:true}} onClose={vi.fn()} onSend={vi.fn()} onDiscardDraft={onDiscardDraft} onRestart={onRestart}/>);
   await userEvent.click(screen.getByRole('button',{name:'Reescrever tentativa'}));
   expect(await screen.findByRole('alert')).toHaveTextContent(/Não é seguro criar outra tentativa/);
   expect(onRestart).not.toHaveBeenCalled();
   expect(screen.getByRole('button',{name:'Tentar novamente'})).toBeDisabled();
   vi.restoreAllMocks();
 });

 it('não considera salvo um rascunho recriado ainda sem revisão',()=>{
   const warn=vi.fn();
   render(<Composer mailboxId="box" initialDraft={{id:'novo',revision:0,to:'ana@example.com',cc:'',bcc:'',subject:'Novo',text:'Corpo',attachments:[]}} onClose={vi.fn()} onSend={vi.fn()} onSaveDraft={vi.fn().mockResolvedValue({revision:1})}/>);
   expect(screen.getByRole('status')).toHaveTextContent('Alterações pendentes');
   window.addEventListener('beforeunload',warn);
   const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);
   expect(event.defaultPrevented).toBe(true);
   window.removeEventListener('beforeunload',warn);
 });
