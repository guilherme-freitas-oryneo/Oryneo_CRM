import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, CheckCheck, ChevronDown, CircleHelp, Clock3, Headphones, MessageCircle, Phone, Reply, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import type { DealRow } from '../data';
import { buildWhatsAppUrl } from '../firstContact/whatsapp';
import { deleteWhatsAppMessageForMe, loadWhatsAppInbox, loadWhatsAppMessages, markWhatsAppRead, sendWhatsAppMessage, sendWhatsAppReaction, type Channel, type Conversation, type Message } from './api';
import { WhatsAppComposer, type WhatsAppDraft } from './WhatsAppComposer';
import { WhatsAppMediaAttachment } from './WhatsAppMediaAttachment';
import './whatsapp.css';

const contactName = (deal: DealRow) => deal.data.contact || deal.data.company || deal.data.title;
const conversationName = (conversation: Conversation) => conversation.customer_name || '+' + conversation.customer_wa_id;
const mediaLabel: Record<Message['kind'], string> = { text: '', audio: 'Áudio recebido', image: 'Imagem recebida', document: 'Documento recebido', video: 'Vídeo recebido', other: 'Mensagem recebida' };
const modeLabel: Record<Conversation['mode'], string> = { sdr_active: 'Automação', review: 'Em revisão', human_locked: 'Atendimento humano', resolved: 'Resolvida' };
const crmTimeZone = 'America/Sao_Paulo';
const messageDayKey = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: crmTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const messageDayLabel = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: crmTimeZone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value));
const messageTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: crmTimeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const messageDateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: crmTimeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
type InboxFilter = 'all' | 'unread' | 'review' | 'human';

export function WhatsAppWorkspace({ deals, loading, loadError, onOpenDeal }: { deals: DealRow[]; loading: boolean; loadError: string; onOpenDeal(id: string): void }) {
  const [query, setQuery] = useState('');
  const [inboxFilter,setInboxFilter] = useState<InboxFilter>('all');
  const pendingSendRef = useRef<{ conversationId: string; fingerprint: string; requestId: string } | null>(null);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inboxError, setInboxError] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [readError, setReadError] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [messageActionError, setMessageActionError] = useState('');
  const contacts = useMemo(() => deals.filter(deal => buildWhatsAppUrl(deal.data.phone)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [deals]);
  const selectedConversation = conversations.find(conversation => conversation.id === selectedConversationId) ?? null;
  const selectedDeal = contacts.find(deal => deal.id === selectedContactId) ?? deals.find(deal => deal.id === selectedConversation?.deal_id) ?? null;
  const recipientName = selectedConversation ? conversationName(selectedConversation) : selectedDeal ? contactName(selectedDeal) : '';
  const recipientPhone = selectedConversation ? '+' + selectedConversation.customer_wa_id : selectedDeal?.data.phone || '';
  const hasSelection = !!selectedConversation || !!selectedDeal;
  const lastInboundElapsed = selectedConversation?.last_inbound_at ? Date.now() - Date.parse(selectedConversation.last_inbound_at) : Number.POSITIVE_INFINITY;
  const windowOpen = lastInboundElapsed >= 0 && lastInboundElapsed < 24 * 60 * 60 * 1000;
  const canReply = Boolean(selectedConversation && channel?.enabled && !selectedConversation.opted_out
    && (selectedConversation.mode === 'review' || selectedConversation.mode === 'human_locked') && windowOpen);
  const disabledReason = !selectedConversation
    ? 'É necessário receber uma mensagem oficial deste contato antes de responder pelo CRM.'
    : !channel?.enabled ? 'Canal ainda em homologação. O envio permanece bloqueado.'
      : selectedConversation.opted_out ? 'Contato optou por não receber mensagens.'
        : !windowOpen ? 'Janela de atendimento encerrada. Utilize um modelo aprovado pela Meta.'
          : 'Assuma o atendimento humano para enviar mensagens.';
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
  const shownConversations = conversations.filter(conversation => {
    const matchesQuery = [conversationName(conversation), conversation.customer_wa_id, conversation.last_preview].join(' ').toLocaleLowerCase('pt-BR').includes(normalizedQuery);
    const matchesFilter = inboxFilter === 'all' || (inboxFilter === 'unread' && (conversation.unread_count ?? 0) > 0)
      || (inboxFilter === 'review' && conversation.mode === 'review') || (inboxFilter === 'human' && conversation.mode === 'human_locked');
    return matchesQuery && matchesFilter;
  });
  const shownContacts = contacts.filter(deal => [deal.data.contact, deal.data.company, deal.data.phone, deal.data.title].join(' ').toLocaleLowerCase('pt-BR').includes(normalizedQuery));

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await loadWhatsAppInbox();
        if (active) { setChannel(next.channel); setConversations(next.conversations); setInboxError(false); }
      } catch { if (active) setInboxError(true); }
    };
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!selectedConversationId) { setMessages([]); return; }
    let active = true;
    const refresh = async () => {
      try { const next = await loadWhatsAppMessages(selectedConversationId); if (active) setMessages(next); }
      catch { if (active) setInboxError(true); }
      finally { if (active) setMessagesLoading(false); }
    };
    setMessagesLoading(true);
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [selectedConversationId]);
  const selectConversation = (id: string) => { pendingSendRef.current = null; setReplyTo(null); setSelectedConversationId(id); setSelectedContactId(null); setContextOpen(false); };
  const selectContact = (id: string) => { setSelectedContactId(id); setSelectedConversationId(null); setContextOpen(false); };
  const close = () => { pendingSendRef.current = null; setReplyTo(null); setSelectedContactId(null); setSelectedConversationId(null); setContextOpen(false); };
  useEffect(() => {
    if (!selectedConversationId || !channel?.enabled || !(selectedConversation?.unread_count ?? 0)) return;
    let active = true;
    setReadError('');
    void markWhatsAppRead(selectedConversationId).then(loadWhatsAppInbox).then(next => {
      if (active) setConversations(next.conversations);
    }).catch(() => { if (active) setReadError('Não foi possível confirmar a leitura na Meta.'); });
    return () => { active = false; };
  }, [selectedConversationId, selectedConversation?.unread_count, channel?.enabled]);
  const sendReply = async (draft: WhatsAppDraft) => {
    if (!selectedConversation || !canReply) throw new Error('Envio indisponível. Verifique o estado do canal.');
    // Mesma tentativa => mesma chave em eventual retry; impedimos envio duplo por falha ambígua.
    const fingerprint = draft.kind === 'text' ? 'text:' + draft.text
      : [draft.kind, draft.file.name, draft.file.size, draft.file.lastModified, draft.kind === 'attachment' ? draft.caption : ''].join(':');
    if (!pendingSendRef.current || pendingSendRef.current.conversationId !== selectedConversation.id || pendingSendRef.current.fingerprint !== fingerprint) {
      pendingSendRef.current = { conversationId: selectedConversation.id, fingerprint, requestId: crypto.randomUUID() };
    }
    if (replyTo) await sendWhatsAppMessage(selectedConversation.id, draft, pendingSendRef.current.requestId, replyTo.id);
    else await sendWhatsAppMessage(selectedConversation.id, draft, pendingSendRef.current.requestId);
    pendingSendRef.current = null;
    setReplyTo(null);
    try {
      const [newMessages, refreshed] = await Promise.all([
        loadWhatsAppMessages(selectedConversation.id), loadWhatsAppInbox(),
      ]);
      setMessages(newMessages);
      setConversations(refreshed.conversations);
      setChannel(refreshed.channel);
      setInboxError(false);
    } catch { setInboxError(true); }
  };
  const refreshSelectedMessages = async () => {
    if (!selectedConversation) return;
    setMessages(await loadWhatsAppMessages(selectedConversation.id));
  };
  const reactToMessage = async (message: Message, emoji: string) => {
    if (!selectedConversation || !canReply) return;
    setMessageActionError('');
    try { await sendWhatsAppReaction(selectedConversation.id, message.id, emoji, crypto.randomUUID()); await refreshSelectedMessages(); }
    catch (reason) { setMessageActionError(reason instanceof Error ? reason.message : 'Não foi possível reagir.'); }
  };
  const deleteForMe = async (message: Message) => {
    if (!selectedConversation) return;
    setMessageActionError('');
    try { await deleteWhatsAppMessageForMe(selectedConversation.id, message.id); await refreshSelectedMessages(); }
    catch (reason) { setMessageActionError(reason instanceof Error ? reason.message : 'Não foi possível apagar.'); }
  };
  const reactionsByTarget = messages.reduce<Record<string,Message[]>>((acc,message) => {
    if (message.reaction_to_provider_message_id && message.reaction_emoji) (acc[message.reaction_to_provider_message_id] ??= []).push(message);
    return acc;
  }, {});
  const visibleMessages = messages.filter(message => !message.reaction_to_provider_message_id);

  return <div className={'wa-workspace' + (hasSelection ? ' wa-selected' : '')}>
    <aside className="wa-list" aria-label="Conversas e contatos do WhatsApp">
      <header className="wa-list-head"><span className="wa-kicker">RELACIONAMENTO</span><h1>WhatsApp</h1><p>Atendimento com o contexto do CRM.</p><div className="wa-channel-status"><span className="wa-status-dot"/><div><strong>{channel?.enabled ? 'Canal habilitado' : 'Canal em preparação'}</strong><small>{channel?.enabled ? channel.display_phone_number : 'Recebimento e envio ainda não estão ativos.'}</small></div></div></header>
      <label className="wa-search"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar conversa ou contato" aria-label="Buscar conversa ou contato"/>{query && <button type="button" aria-label="Limpar busca" onClick={() => setQuery('')}><X size={15}/></button>}</label>
      <div className="wa-filters" aria-label="Filtrar conversas">{([['all','Todas'],['unread','Não lidas'],['review','Em revisão'],['human','Com atendente']] as const).map(([value,label])=><button key={value} type="button" className={inboxFilter === value ? 'active' : ''} aria-pressed={inboxFilter === value} onClick={()=>setInboxFilter(value)}>{label}</button>)}</div>
      {inboxError && <div className="wa-inline-alert" role="alert">Não foi possível atualizar as conversas. Os contatos do CRM continuam disponíveis.</div>}
      <div className="wa-list-count"><span>CONVERSAS</span><span>{shownConversations.length}</span></div>
      <div className="wa-rows">
        {shownConversations.map(conversation => <button type="button" className={'wa-row' + (selectedConversationId === conversation.id ? ' active' : '')} key={conversation.id} aria-label={'Abrir conversa de ' + conversationName(conversation)} aria-current={selectedConversationId === conversation.id ? 'true' : undefined} onClick={() => selectConversation(conversation.id)}><span className="wa-avatar">{conversationName(conversation).slice(0, 1).toUpperCase()}</span><span className="wa-row-body"><strong>{conversationName(conversation)}</strong><small>{conversation.last_preview || 'Mensagem recebida'}</small><span>{modeLabel[conversation.mode]}</span></span>{(conversation.unread_count ?? 0) > 0 ? <span className="wa-unread" aria-label={`${conversation.unread_count} mensagens não lidas`}>{conversation.unread_count}</span> : <span className="wa-row-chevron">›</span>}</button>)}
        {!shownConversations.length && <div className="wa-list-hint">{query ? 'Nenhuma conversa encontrada.' : 'As conversas reais aparecerão aqui após a conexão.'}</div>}
        <div className="wa-list-count wa-contacts-heading"><span>CONTATOS DO CRM</span><span>{shownContacts.length}</span></div>
        {loadError ? <div className="wa-list-empty" role="alert"><CircleHelp size={23}/><strong>Contatos indisponíveis</strong><p>{loadError}</p></div> : loading && !deals.length ? <div className="wa-list-empty" role="status"><Clock3 size={23}/><strong>Carregando contatos…</strong></div> : shownContacts.length ? shownContacts.map(deal => <button type="button" className={'wa-row' + (selectedContactId === deal.id ? ' active' : '')} key={deal.id} aria-label={'Abrir contato ' + contactName(deal)} aria-current={selectedContactId === deal.id ? 'true' : undefined} onClick={() => selectContact(deal.id)}><span className="wa-avatar">{contactName(deal).slice(0, 1).toUpperCase()}</span><span className="wa-row-body"><strong>{contactName(deal)}</strong><small>{deal.data.company || deal.data.title}</small><span>{deal.data.phone}</span></span><span className="wa-row-chevron">›</span></button>) : <div className="wa-list-empty"><Search size={23}/><strong>{query ? 'Nenhum contato encontrado' : 'Nenhum contato com telefone'}</strong><p>{query ? 'Tente outro nome, empresa ou número.' : 'Os contatos do pipeline com telefone aparecerão aqui.'}</p></div>}
      </div>
      <footer className="wa-list-footer"><ShieldCheck size={15}/> Mensagens aparecem somente após confirmação do servidor.</footer>
    </aside>
    <section className="wa-thread" aria-label="Área de conversa">
      {hasSelection ? <><header className="wa-thread-head"><button type="button" className="wa-icon wa-back" aria-label="Voltar às conversas" onClick={close}><ArrowLeft size={19}/></button><span className="wa-avatar">{recipientName.slice(0, 1).toUpperCase()}</span><div className="wa-thread-identity"><strong>{recipientName}</strong><small>{recipientPhone} · {selectedConversation ? modeLabel[selectedConversation.mode] : 'Contato do CRM'}</small></div><button type="button" className="wa-icon" aria-label="Abrir contexto do contato" aria-expanded={contextOpen} onClick={() => setContextOpen(value => !value)}><CircleHelp size={19}/></button></header><div className="wa-messages">{readError && <div className="wa-inline-alert" role="alert">{readError}</div>}{messageActionError && <div className="wa-inline-alert" role="alert">{messageActionError}</div>}{selectedConversation ? messagesLoading ? <div className="wa-conversation-empty" role="status">Carregando mensagens…</div> : visibleMessages.length ? <div className="wa-message-list">{visibleMessages.map((message,index) => <Fragment key={message.id}>{(index === 0 || messageDayKey(visibleMessages[index - 1].occurred_at) !== messageDayKey(message.occurred_at)) && <div className="wa-date-separator"><span>{messageDayLabel(message.occurred_at)}</span></div>}<WhatsAppMessageView message={message} quoted={messages.find(candidate => candidate.provider_message_id === message.reply_to_provider_message_id)} reactions={message.provider_message_id ? reactionsByTarget[message.provider_message_id] : undefined} reactionActorName={recipientName} canInteract={canReply} onReply={() => setReplyTo(message)} onReact={emoji => void reactToMessage(message,emoji)} onDelete={() => void deleteForMe(message)}/></Fragment>)}</div> : <div className="wa-conversation-empty">Nenhuma mensagem disponível.</div> : <div className="wa-conversation-empty"><span className="wa-empty-symbol"><MessageCircle size={27}/></span><h2>Conversa ainda não conectada</h2><p>Este contato está no CRM, mas não há uma conversa oficial vinculada a ele.</p><span><Clock3 size={15}/> Nenhuma mensagem importada</span></div>}</div><WhatsAppComposer key={selectedConversationId || selectedContactId} enabled={canReply} disabledReason={disabledReason} replyPreview={replyTo ? (replyTo.body || mediaLabel[replyTo.kind]).slice(0,120) : undefined} onCancelReply={() => setReplyTo(null)} onSend={sendReply}/>{!selectedConversation && selectedDeal && <a className="wa-external-link" href={buildWhatsAppUrl(selectedDeal.data.phone) ?? '#'} target="_blank" rel="noopener noreferrer">Abrir WhatsApp externo <ArrowUpRight size={13}/></a>}</> : <div className="wa-thread-idle"><span className="wa-empty-symbol"><Headphones size={29}/></span><h2>Atendimento em um só lugar</h2><p>Selecione uma conversa recebida ou um contato do CRM para consultar o contexto.</p><span><CheckCheck size={16}/> Sem conversas simuladas</span></div>}
    </section>
    <aside className={'wa-context' + (contextOpen ? ' open' : '')} aria-label="Contexto do contato"><header><span className="wa-kicker">CONTEXTO</span><button type="button" className="wa-icon wa-context-close" aria-label="Fechar contexto" onClick={() => setContextOpen(false)}><X size={18}/></button><h2>Dados para atender melhor</h2></header>{hasSelection ? <><section><div className="wa-context-name"><span className="wa-avatar">{recipientName.slice(0, 1).toUpperCase()}</span><div><strong>{recipientName}</strong><small>{selectedDeal?.data.company || 'Contato sem vínculo confirmado'}</small></div></div><dl><div><dt>Telefone</dt><dd>{recipientPhone}</dd></div><div><dt>Origem</dt><dd>{selectedDeal?.data.source || 'Não informada'}</dd></div><div><dt>Consentimento</dt><dd>{selectedConversation?.consent_granted ? 'Registrado' : 'A verificar'}</dd></div></dl></section><section><h3>Oportunidade</h3>{selectedDeal ? <div className="wa-deal"><strong>{selectedDeal.data.title}</strong><small>{selectedDeal.data.next_action?.title || 'Sem próxima ação definida'}</small><button type="button" onClick={() => onOpenDeal(selectedDeal.id)}>Abrir no pipeline <ArrowUpRight size={14}/></button></div> : <p className="wa-unlinked">Nenhuma oportunidade foi vinculada a esta conversa.</p>}</section><section><h3>Canais disponíveis</h3><a className="wa-contact-action" href={'tel:' + recipientPhone.replace(/[^\d+]/g, '')}><Phone size={16}/><span>Ligar pelo telefone<small>Usa o discador do dispositivo</small></span><ArrowUpRight size={14}/></a><div className="wa-contact-disabled"><Phone size={16}/><span>Ligação pelo WhatsApp<small>Depende da disponibilidade da Meta</small></span></div></section></> : <div className="wa-context-placeholder">Selecione um contato para consultar a oportunidade e os canais disponíveis.</div>}</aside>
  </div>;
}

export function WhatsAppMessageView({ message, quoted, reactions, reactionActorName='Contato', canInteract=false, onReply, onReact, onDelete }: { message: Message; quoted?: Message; reactions?: Message[]; reactionActorName?: string; canInteract?: boolean; onReply?:()=>void; onReact?:(emoji:string)=>void; onDelete?:()=>void }) {
  const outbound = message.direction === 'outbound';
  const [reactionDetailsOpen,setReactionDetailsOpen] = useState(false);
  const [actionsOpen,setActionsOpen] = useState(false);
  return <article className={'wa-message ' + (outbound ? 'outbound' : 'inbound')}><div className="wa-message-bubble"><button type="button" className="wa-message-menu-trigger" aria-label="Ações da mensagem" aria-expanded={actionsOpen} onClick={()=>setActionsOpen(value=>!value)}><ChevronDown size={14}/></button>{quoted && <div className="wa-message-quote">{quoted.body || mediaLabel[quoted.kind]}</div>}<p>{message.body || mediaLabel[message.kind]}</p><WhatsAppMediaAttachment message={message}/>{reactions?.length ? <div className="wa-reaction-wrap"><button type="button" className="wa-message-reactions" aria-label={`Ver detalhes de ${reactions.length} ${reactions.length === 1 ? 'reação' : 'reações'}`} aria-expanded={reactionDetailsOpen} onClick={()=>setReactionDetailsOpen(value=>!value)}>{reactions.map(reaction=>reaction.reaction_emoji).join(' ')}</button>{reactionDetailsOpen && <div className="wa-reaction-details">{reactions.map(reaction=><div key={reaction.id}><strong>{reaction.direction === 'inbound' ? reactionActorName : 'Equipe ORYNEO'} reagiu com {reaction.reaction_emoji}</strong><time dateTime={reaction.occurred_at}>{messageDateTime(reaction.occurred_at)}</time></div>)}</div>}</div> : null}<footer><time dateTime={message.occurred_at}>{messageTime(message.occurred_at)}</time>{outbound && <span>{message.delivery_status === 'failed' ? 'Falhou' : message.delivery_status === 'read' ? 'Lida' : message.delivery_status === 'delivered' ? 'Entregue' : message.delivery_status === 'sent' ? 'Enviada' : 'Pendente'}</span>}</footer>{actionsOpen && <div className="wa-message-actions">{canInteract && <><button type="button" aria-label="Responder à mensagem" onClick={()=>{setActionsOpen(false);onReply?.()}}><Reply size={13}/></button>{['👍','❤️','😂','😮','😢','🙏'].map(emoji=><button type="button" key={emoji} aria-label={'Reagir com '+emoji} onClick={()=>{setActionsOpen(false);onReact?.(emoji)}}>{emoji}</button>)}</>}<button type="button" aria-label="Apagar para mim" onClick={()=>{setActionsOpen(false);onDelete?.()}}><Trash2 size={13}/></button></div>}</div></article>;
}
