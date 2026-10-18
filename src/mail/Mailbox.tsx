import { AlertCircle, Edit3, FileText, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import type { DealRow } from '../data';
import type { Action } from '../components';
import { getDraft, getQuota, getStatus, getThread, invokeMailAction, listDrafts, listFolders, listThreads, MAIL_THREADS_PAGE_SIZE, saveDraft, subscribeMail, type DraftSummary } from './api';
import { Composer, type ComposePayload, type DraftSnapshot } from './Composer';
import { payloadFile, type AttachmentPayload } from './compose';
import { Conversation } from './Conversation';
import { FolderList } from './FolderList';
import { ThreadList } from './ThreadList';
import type { MailFolder, MailMessage, MailSyncStatus, MailThreadDetail, MailThreadSummary } from './types';
import './mail.css';

type ComposeState={key:string;reply?:MailMessage;draft?:DraftSnapshot;attachments?:AttachmentPayload[];subject?:string};
export function Mailbox({ deals: _deals, onOpenDeal }: { deals: DealRow[]; onOpenDeal(id: string): void }) {
  const [folders,setFolders]=useState<MailFolder[]>([]),[threads,setThreads]=useState<MailThreadSummary[]>([]),[folderId,setFolderId]=useState<string|null>(null);
  const [threadId,setThreadId]=useState<string|null>(null),[detail,setDetail]=useState<MailThreadDetail|null>(null),[status,setStatus]=useState<MailSyncStatus>({state:'idle',backlog:0});
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[loading,setLoading]=useState(true),[loadingMore,setLoadingMore]=useState(false),[hasMore,setHasMore]=useState(false),[conversationLoading,setConversationLoading]=useState(false),[composer,setComposer]=useState<ComposeState|null>(null),[error,setError]=useState(''),[actionBusy,setActionBusy]=useState(false);
  const [draftView,setDraftView]=useState(false),[drafts,setDrafts]=useState<DraftSummary[]>([]),[draftMore,setDraftMore]=useState(false),[draftBusy,setDraftBusy]=useState(false);
  const [quota,setQuota]=useState<Awaited<ReturnType<typeof getQuota>>|null>(null),[quotaBusy,setQuotaBusy]=useState(false);
  const listEpoch=useRef(0),openEpoch=useRef(0),moreLock=useRef(false),mutationLock=useRef(false),threadRows=useRef(threads),selectedThread=useRef(threadId),active=useRef(true);
  const context=`${folderId}\0${query}\0${filter}`,contextRef=useRef(context);contextRef.current=context;threadRows.current=threads;selectedThread.current=threadId;
  const activeFolder=useMemo(()=>folders.find(f=>f.id===folderId),[folders,folderId]);
  useEffect(()=>{active.current=true;return()=>{active.current=false;listEpoch.current++;openEpoch.current++;};},[]);
  const refresh=useCallback(async(quiet=false)=>{
    const request=++listEpoch.current,scope=contextRef.current;
    if(!quiet){setLoading(true);setHasMore(false);}moreLock.current=false;setLoadingMore(false);
    try{
      const [nextFolders,nextStatus]=await Promise.all([listFolders(),getStatus()]);
      if(!active.current||request!==listEpoch.current||scope!==contextRef.current)return;
      setFolders(nextFolders);setStatus(nextStatus);
      const chosen=folderId??nextFolders.find(f=>f.special_use==='inbox')?.id??nextFolders[0]?.id??null;
      if(!folderId&&chosen){setFolderId(chosen);return;}
      const keep=quiet?Math.max(MAIL_THREADS_PAGE_SIZE,threadRows.current.length):MAIL_THREADS_PAGE_SIZE;
      let rows:MailThreadSummary[]=[],page:MailThreadSummary[]=[];
      do{
        const last=rows.at(-1);
        page=await listThreads(chosen,query,filter,last?{beforeAt:last.last_message_at,beforeId:last.id}:undefined);
        if(!active.current||request!==listEpoch.current||scope!==contextRef.current)return;
        const known=new Set(rows.map(r=>r.id));const incoming=page.filter(r=>!known.has(r.id));rows.push(...incoming);
        if(!incoming.length)break;
      }while(rows.length<keep&&page.length===MAIL_THREADS_PAGE_SIZE);
      setThreads(rows);setHasMore(page.length===MAIL_THREADS_PAGE_SIZE);
    }catch(reason){if(active.current&&request===listEpoch.current)setError(message(reason,'Não foi possível carregar a caixa.'));}
    finally{if(active.current&&request===listEpoch.current)setLoading(false);}
  },[filter,folderId,query]);
  useEffect(()=>{const timer=setTimeout(()=>void refresh(),query?250:0);return()=>clearTimeout(timer);},[refresh]);
  useEffect(()=>{let timer:ReturnType<typeof setTimeout>;const stop=subscribeMail(()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh(true),150);});return()=>{clearTimeout(timer);stop();};},[refresh]);
  const loadMore=async()=>{
    if(!hasMore||moreLock.current||!threads.length||loading)return;
    const epoch=listEpoch.current,scope=contextRef.current,last=threads.at(-1)!;moreLock.current=true;setLoadingMore(true);
    try{const next=await listThreads(folderId,query,filter,{beforeAt:last.last_message_at,beforeId:last.id});if(epoch!==listEpoch.current||scope!==contextRef.current||!active.current)return;setThreads(current=>{const seen=new Set(current.map(t=>t.id));return [...current,...next.filter(t=>!seen.has(t.id))];});setHasMore(next.length===MAIL_THREADS_PAGE_SIZE);}
    catch(reason){if(epoch===listEpoch.current)setError(message(reason,'Não foi possível carregar mais conversas.'));}
    finally{if(epoch===listEpoch.current){moreLock.current=false;setLoadingMore(false);}}
  };
  const onScroll=(event:UIEvent<HTMLDivElement>)=>{const el=event.currentTarget;if(el.scrollHeight-el.scrollTop-el.clientHeight<180)void loadMore();};
  const closeThread=()=>{openEpoch.current++;setThreadId(null);setDetail(null);setConversationLoading(false);};
  const openThread=async(thread:MailThreadSummary)=>{
    const epoch=++openEpoch.current;setThreadId(thread.id);setDetail(null);setConversationLoading(true);setError('');
    try{const next=await getThread(thread.id);if(epoch!==openEpoch.current||!active.current)return;setDetail(next);
      const unread=next.messages.flatMap(m=>m.locations).filter(l=>l.id&&!l.flags.includes('\\Seen'));
      if(unread.length){const result=await Promise.allSettled(unread.map(l=>invokeMailAction('set-flags',{locationId:l.id,flag:'seen',value:true})));if(epoch!==openEpoch.current||!active.current)return;if(result.some(r=>r.status==='rejected'))setError('Não foi possível marcar todas as mensagens como lidas.');else setDetail({...next,messages:next.messages.map(m=>({...m,unread:false,locations:m.locations.map(l=>({...l,flags:[...new Set([...l.flags,'\\Seen'])]}))}))});void refresh(true);}
    }catch(reason){if(epoch===openEpoch.current)setError(message(reason,'Não foi possível abrir a conversa.'));}
    finally{if(epoch===openEpoch.current&&active.current)setConversationLoading(false);}
  };
  const manualSync=async()=>{setStatus(s=>({...s,state:'syncing'}));try{await invokeMailAction('sync-now',{});await refresh(true);}catch(reason){setError(message(reason,'A sincronização falhou.'));setStatus(s=>({...s,state:'error'}));}};
  const send=async(payload:ComposePayload)=>{await invokeMailAction('send',payload);void refresh(true);};
  const startCompose=(state:Omit<ComposeState,'key'>={})=>{if(composer){setError('Salve e feche a composição atual antes de abrir outra.');return;}setComposer({key:crypto.randomUUID(),...state});};
  const act=async(action:string,thread:MailThreadSummary,one?:MailMessage,target?:MailFolder)=>{
    if(mutationLock.current)return;
    if(action==='trash'&&!window.confirm('Mover para a lixeira? Você poderá recuperar pela pasta Lixeira.'))return;
    mutationLock.current=true;setActionBusy(true);setError('');
    try{
      const messages=one?[one]:(await getThread(thread.id)).messages;
      const locations=messages.flatMap(m=>m.locations).filter(l=>l.id&&(!target||!folderId||l.folder_id===folderId));
      if(!locations.length)throw new Error('A mensagem mudou de pasta. Sincronize e tente novamente.');
      if(action==='forward'||action==='download'){
        if(action==='forward'&&composer)throw new Error('Salve e feche a composição atual antes de encaminhar.');
        const payload=await invokeMailAction<AttachmentPayload>('export-message',{locationId:locations[0].id});
        if(action==='forward')startCompose({subject:`Enc: ${one?.subject??thread.subject}`,attachments:[payload]});
        else{const url=URL.createObjectURL(payloadFile(payload));const a=document.createElement('a');a.href=url;a.download=payload.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
        return;
      }
      const result=await Promise.allSettled(locations.map(l=>target?invokeMailAction('move',{locationId:l.id,targetFolderId:target.id}):invokeMailAction('set-flags',{locationId:l.id,flag:action==='star'?'starred':'seen',value:action==='star'?!thread.starred:!thread.unread})));
      if(result.some(r=>r.status==='rejected'))setError('Algumas mensagens não foram alteradas. Sincronize a caixa antes de tentar novamente.');
      if(selectedThread.current===thread.id){if(target)closeThread();else{const current=await getThread(thread.id);if(selectedThread.current===thread.id)setDetail(current);}}
      await refresh(true);
    }catch(reason){setError(message(reason,'Não foi possível concluir a ação.'));}
    finally{mutationLock.current=false;setActionBusy(false);}
  };
  const actions=(thread:MailThreadSummary,one?:MailMessage):Action[]=>[
    {label:thread.unread?'Marcar como lido':'Marcar como não lido',action:()=>void act('seen',thread,one),disabled:actionBusy},
    {label:thread.starred?'Remover favorito':'Favoritar',action:()=>void act('star',thread,one),disabled:actionBusy},
    {label:one?'Encaminhar como anexo (.eml)':'Encaminhar mensagem como anexo (.eml)',action:()=>void act('forward',thread,one),disabled:actionBusy||!!composer||(!one&&thread.message_count!==1)},
    ...(one?[{label:'Baixar original (.eml)',action:()=>void act('download',thread,one),disabled:actionBusy}]:[]),
    ...folders.filter(f=>f.id!==folderId&&f.special_use!=='drafts'&&f.special_use!=='sent').map(f=>({label:f.special_use==='trash'?'Mover para lixeira':f.special_use==='archive'?'Arquivar':f.special_use==='junk'?'Marcar como spam':`Mover para ${f.name}`,danger:f.special_use==='trash',disabled:actionBusy,action:()=>void act(f.special_use==='trash'?'trash':'move',thread,one,f)})),
  ];
  const loadDrafts=async(more=false)=>{if(!status.mailbox_id||draftBusy)return;setDraftBusy(true);try{const next=await listDrafts(status.mailbox_id,more?drafts.length:0);setDrafts(old=>more?[...old,...next]:next);setDraftMore(next.length===50);}catch(reason){setError(message(reason,'Não foi possível carregar rascunhos.'));}finally{setDraftBusy(false);}};
  const readDraft=async(id:string)=>{if(composer){setError('Salve e feche a composição atual primeiro.');return;}try{startCompose({draft:await getDraft(id)});}catch(reason){setError(message(reason,'Não foi possível abrir o rascunho.'));}};
  const attachment=async(id:string)=>{try{const result=await invokeMailAction<{url:string}>('attachment-url',{attachmentId:id});const a=document.createElement('a');a.href=result.url;a.target='_blank';a.rel='noopener noreferrer';a.click();}catch(reason){setError(message(reason,'Não foi possível abrir o anexo.'));}};
  return <div className="mailbox-shell">
    <aside className="mailbox-folders-panel"><button className="mail-compose-button" onClick={()=>startCompose()}><Edit3 size={17}/>Escrever</button><FolderList folders={folders} selected={draftView?null:folderId} onSelect={id=>{setDraftView(false);setFolderId(id);closeThread();}}/><button className={`mail-drafts-button ${draftView?'active':''}`} title="Meus rascunhos" aria-label="Meus rascunhos" onClick={()=>{setDraftView(true);closeThread();void loadDrafts();}}><FileText size={17}/><span>Meus rascunhos</span></button>
      <div className="mail-quota"><button disabled={quotaBusy||!status.mailbox_id} onClick={()=>{setQuotaBusy(true);void getQuota(status.mailbox_id!).then(setQuota).catch(()=>setQuota({quota:null,checkedAt:new Date().toISOString()})).finally(()=>setQuotaBusy(false));}}>{quotaBusy?'Consultando…':'Consultar armazenamento'}</button>{quota&&(quota.quota?<><progress aria-label="Armazenamento usado" max={quota.quota.limitBytes} value={quota.quota.usedBytes}/><span>{(quota.quota.usedBytes/quota.quota.limitBytes*100).toFixed(1)}% · {(quota.quota.usedBytes/1024/1024).toFixed(1)} de {(quota.quota.limitBytes/1024/1024).toFixed(0)} MiB</span></>:<span>Quota indisponível no provedor.</span>)}{quota&&<small>Consulta: {new Date(quota.checkedAt).toLocaleTimeString('pt-BR')}</small>}</div>
      <div className={`mail-sync-state ${status.state}`}><i/><span>{status.state==='syncing'?'Sincronizando…':status.state==='error'?'Sincronização com atenção':status.backlog?`${status.backlog} mensagens na fila`:status.last_success_at?`Última sincronização ${new Date(status.last_success_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`:'Aguardando status da sincronização'}</span></div></aside>
    <section className={`mailbox-list-panel ${threadId?'mobile-hidden':''}`}><header><div><h1>{draftView?'Meus rascunhos':activeFolder?.name??'E-mail'}</h1><span>{draftView?`${drafts.length} carregados`:`${activeFolder?.total_count??0} mensagens`}</span></div><button className="mail-icon-button" aria-label="Sincronizar agora" onClick={()=>void(draftView?loadDrafts():manualSync())} disabled={status.state==='syncing'}><RefreshCw size={17}/></button></header>
      {!draftView&&<div className="mail-search"><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar e-mails" aria-label="Buscar e-mails"/>{query&&<button onClick={()=>setQuery('')} aria-label="Limpar busca"><X size={14}/></button>}<label><SlidersHorizontal size={14}/><select aria-label="Filtrar e-mails" value={filter} onChange={event=>setFilter(event.target.value)}><option value="all">Todos</option><option value="unread">Não lidos</option><option value="starred">Favoritos</option><option value="attachments">Com anexos</option></select></label></div>}
      {error&&<div className="mail-error" role="alert"><AlertCircle size={15}/>{error}<button aria-label="Fechar erro" onClick={()=>setError('')}><X size={13}/></button></div>}
      {draftView?<div className="mail-drafts-list">{draftBusy?<p role="status">Carregando rascunhos…</p>:!drafts.length?<p>Nenhum rascunho salvo.</p>:null}{drafts.map(d=><button key={d.id} onClick={()=>void readDraft(d.id)}><strong>{d.subject||'(sem assunto)'}</strong><small>{d.state==='sending'?'Envio em conciliação · ':''}{new Date(d.updated_at).toLocaleString('pt-BR')}</small></button>)}{draftMore&&<button disabled={draftBusy} onClick={()=>void loadDrafts(true)}>Carregar mais rascunhos</button>}</div>:<ThreadList threads={threads} selected={threadId} loading={loading} loadingMore={loadingMore} hasMore={hasMore} onLoadMore={()=>void loadMore()} onScroll={onScroll} onSelect={thread=>void openThread(thread)} actions={actions}/>}
    </section>
    <main className={`mailbox-reading-panel ${!threadId?'mobile-hidden':''}`}>{conversationLoading?<div className="mail-reader-empty"><RefreshCw className="spinner"/>Abrindo conversa…</div>:detail?<Conversation detail={detail} onBack={closeThread} onReply={reply=>startCompose({reply})} onAttachment={id=>void attachment(id)} onOpenDeal={onOpenDeal} actions={m=>actions({id:m.thread_id,subject:m.subject,participants:[],preview:'',last_message_at:m.sent_at,unread:m.unread,starred:m.starred,has_attachments:!!m.attachments.length,message_count:1,deal_links:[]},m)}/>:<div className="mail-reader-empty"><strong>Suas conversas em um só lugar</strong><p>Selecione um e-mail para ler, responder e organizar.</p></div>}</main>
    {composer&&status.mailbox_id&&<Composer key={composer.key} mailboxId={status.mailbox_id} replyTo={composer.reply} initialDraft={composer.draft} initialAttachments={composer.attachments} initialSubject={composer.subject} onClose={()=>{setComposer(null);if(draftView)void loadDrafts();}} onSend={send} onSaveDraft={draft=>saveDraft(status.mailbox_id!,draft)} onRestart={draft=>{setComposer({key:crypto.randomUUID(),draft});if(draftView)void loadDrafts();}} onDiscardDraft={async id=>{if(composer.draft?.revision)await invokeMailAction('delete-draft',{draftId:id});else{try{await invokeMailAction('delete-draft',{draftId:id});}catch(reason){if(!String(reason).includes('NOT_FOUND'))throw reason;}}}}/>}
  </div>;
}
function message(reason:unknown,fallback:string){return reason instanceof Error?reason.message:fallback;}
