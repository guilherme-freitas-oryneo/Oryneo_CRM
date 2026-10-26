import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowUpRight, CheckCheck, CircleHelp, Clock3, Headphones, MessageCircle, Phone, Search, ShieldCheck, X } from 'lucide-react';
import type { DealRow } from '../data';
import { buildWhatsAppUrl } from '../firstContact/whatsapp';
import { loadWhatsAppInbox, loadWhatsAppMessages, type Channel, type Conversation, type Message } from './api';
import { WhatsAppComposer } from './WhatsAppComposer';
import './whatsapp.css';

const contactName = (deal: DealRow) => deal.data.contact || deal.data.company || deal.data.title;
const conversationName = (conversation: Conversation) => conversation.customer_name || '+' + conversation.customer_wa_id;
const mediaLabel: Record<Message['kind'], string> = { text: '', audio: 'Áudio recebido', image: 'Imagem recebida', document: 'Documento recebido', video: 'Vídeo recebido', other: 'Mensagem recebida' };
const modeLabel: Record<Conversation['mode'], string> = { sdr_active: 'Automação', review: 'Em revisão', human_locked: 'Atendimento humano', resolved: 'Resolvida' };

export function WhatsAppWorkspace({ deals, loading, loadError, onOpenDeal }: { deals: DealRow[]; loading: boolean; loadError: string; onOpenDeal(id: string): void }) {
  const [query, setQuery] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inboxError, setInboxError] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const contacts = useMemo(() => deals.filter(deal => buildWhatsAppUrl(deal.data.phone)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [deals]);
  const selectedConversation = conversations.find(conversation => conversation.id === selectedConversationId) ?? null;
  const selectedDeal = contacts.find(deal => deal.id === selectedContactId) ?? deals.find(deal => deal.id === selectedConversation?.deal_id) ?? null;
  const recipientName = selectedConversation ? conversationName(selectedConversation) : selectedDeal ? contactName(selectedDeal) : '';
  const recipientPhone = selectedConversation ? '+' + selectedConversation.customer_wa_id : selectedDeal?.data.phone || '';
  const hasSelection = !!selectedConversation || !!selectedDeal;
  const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
  const shownConversations = conversations.filter(conversation => [conversationName(conversation), conversation.customer_wa_id, conversation.last_preview].join(' ').toLocaleLowerCase('pt-BR').includes(normalizedQuery));
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
  const selectConversation = (id: string) => { setSelectedConversationId(id); setSelectedContactId(null); setContextOpen(false); };
  const selectContact = (id: string) => { setSelectedContactId(id); setSelectedConversationId(null); setContextOpen(false); };
  const close = () => { setSelectedContactId(null); setSelectedConversationId(null); setContextOpen(false); };

  return <div className={'wa-workspace' + (hasSelection ? ' wa-selected' : '')}>
    <aside className="wa-list" aria-label="Conversas e contatos do WhatsApp">
      <header className="wa-list-head"><span className="wa-kicker">RELACIONAMENTO</span><h1>WhatsApp</h1><p>Atendimento com o contexto do CRM.</p><div className="wa-channel-status"><span className="wa-status-dot"/><div><strong>{channel?.enabled ? 'Canal conectado' : 'Canal em preparação'}</strong><small>{channel?.enabled ? channel.display_phone_number : 'Recebimento e envio ainda não estão ativos.'}</small></div></div></header>
      <label className="wa-search"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar conversa ou contato" aria-label="Buscar conversa ou contato"/>{query && <button type="button" aria-label="Limpar busca" onClick={() => setQuery('')}><X size={15}/></button>}</label>
      {inboxError && <div className="wa-inline-alert" role="alert">Não foi possível atualizar as conversas. Os contatos do CRM continuam disponíveis.</div>}
      <div className="wa-list-count"><span>CONVERSAS</span><span>{shownConversations.length}</span></div>
      <div className="wa-rows">
        {shownConversations.map(conversation => <button type="button" className={'wa-row' + (selectedConversationId === conversation.id ? ' active' : '')} key={conversation.id} aria-label={'Abrir conversa de ' + conversationName(conversation)} aria-current={selectedConversationId === conversation.id ? 'true' : undefined} onClick={() => selectConversation(conversation.id)}><span className="wa-avatar">{conversationName(conversation).slice(0, 1).toUpperCase()}</span><span className="wa-row-body"><strong>{conversationName(conversation)}</strong><small>{conversation.last_preview || 'Mensagem recebida'}</small><span>{modeLabel[conversation.mode]}</span></span><span className="wa-row-chevron">›</span></button>)}
        {!shownConversations.length && <div className="wa-list-hint">{query ? 'Nenhuma conversa encontrada.' : 'As conversas reais aparecerão aqui após a conexão.'}</div>}
        <div className="wa-list-count wa-contacts-heading"><span>CONTATOS DO CRM</span><span>{shownContacts.length}</span></div>
        {loadError ? <div className="wa-list-empty" role="alert"><CircleHelp size={23}/><strong>Contatos indisponíveis</strong><p>{loadError}</p></div> : loading && !deals.length ? <div className="wa-list-empty" role="status"><Clock3 size={23}/><strong>Carregando contatos…</strong></div> : shownContacts.length ? shownContacts.map(deal => <button type="button" className={'wa-row' + (selectedContactId === deal.id ? ' active' : '')} key={deal.id} aria-label={'Abrir contato ' + contactName(deal)} aria-current={selectedContactId === deal.id ? 'true' : undefined} onClick={() => selectContact(deal.id)}><span className="wa-avatar">{contactName(deal).slice(0, 1).toUpperCase()}</span><span className="wa-row-body"><strong>{contactName(deal)}</strong><small>{deal.data.company || deal.data.title}</small><span>{deal.data.phone}</span></span><span className="wa-row-chevron">›</span></button>) : <div className="wa-list-empty"><Search size={23}/><strong>{query ? 'Nenhum contato encontrado' : 'Nenhum contato com telefone'}</strong><p>{query ? 'Tente outro nome, empresa ou número.' : 'Os contatos do pipeline com telefone aparecerão aqui.'}</p></div>}
      </div>
      <footer className="wa-list-footer"><ShieldCheck size={15}/> Mensagens aparecem somente após confirmação do servidor.</footer>
    </aside>
    <section className="wa-thread" aria-label="Área de conversa">
      {hasSelection ? <><header className="wa-thread-head"><button type="button" className="wa-icon wa-back" aria-label="Voltar às conversas" onClick={close}><ArrowLeft size={19}/></button><span className="wa-avatar">{recipientName.slice(0, 1).toUpperCase()}</span><div className="wa-thread-identity"><strong>{recipientName}</strong><small>{recipientPhone} · {selectedConversation ? modeLabel[selectedConversation.mode] : 'Contato do CRM'}</small></div><button type="button" className="wa-icon" aria-label="Abrir contexto do contato" aria-expanded={contextOpen} onClick={() => setContextOpen(value => !value)}><CircleHelp size={19}/></button></header><div className="wa-messages">{selectedConversation ? messagesLoading ? <div className="wa-conversation-empty" role="status">Carregando mensagens…</div> : messages.length ? <div className="wa-message-list">{messages.map(message => <WhatsAppMessageView key={message.id} message={message}/>)}</div> : <div className="wa-conversation-empty">Nenhuma mensagem disponível.</div> : <div className="wa-conversation-empty"><span className="wa-empty-symbol"><MessageCircle size={27}/></span><h2>Conversa ainda não conectada</h2><p>Este contato está no CRM, mas não há uma conversa oficial vinculada a ele.</p><span><Clock3 size={15}/> Nenhuma mensagem importada</span></div>}</div><WhatsAppComposer key={selectedConversationId || selectedContactId} enabled={false} disabledReason="Envio, áudio e anexos serão liberados após a conexão oficial e as verificações do canal."/>{!selectedConversation && selectedDeal && <a className="wa-external-link" href={buildWhatsAppUrl(selectedDeal.data.phone) ?? '#'} target="_blank" rel="noopener noreferrer">Abrir WhatsApp externo <ArrowUpRight size={13}/></a>}</> : <div className="wa-thread-idle"><span className="wa-empty-symbol"><Headphones size={29}/></span><h2>Atendimento em um só lugar</h2><p>Selecione uma conversa recebida ou um contato do CRM para consultar o contexto.</p><span><CheckCheck size={16}/> Sem conversas simuladas</span></div>}
    </section>
    <aside className={'wa-context' + (contextOpen ? ' open' : '')} aria-label="Contexto do contato"><header><span className="wa-kicker">CONTEXTO</span><button type="button" className="wa-icon wa-context-close" aria-label="Fechar contexto" onClick={() => setContextOpen(false)}><X size={18}/></button><h2>Dados para atender melhor</h2></header>{hasSelection ? <><section><div className="wa-context-name"><span className="wa-avatar">{recipientName.slice(0, 1).toUpperCase()}</span><div><strong>{recipientName}</strong><small>{selectedDeal?.data.company || 'Contato sem vínculo confirmado'}</small></div></div><dl><div><dt>Telefone</dt><dd>{recipientPhone}</dd></div><div><dt>Origem</dt><dd>{selectedDeal?.data.source || 'Não informada'}</dd></div><div><dt>Consentimento</dt><dd>{selectedConversation?.consent_granted ? 'Registrado' : 'A verificar'}</dd></div></dl></section><section><h3>Oportunidade</h3>{selectedDeal ? <div className="wa-deal"><strong>{selectedDeal.data.title}</strong><small>{selectedDeal.data.next_action?.title || 'Sem próxima ação definida'}</small><button type="button" onClick={() => onOpenDeal(selectedDeal.id)}>Abrir no pipeline <ArrowUpRight size={14}/></button></div> : <p className="wa-unlinked">Nenhuma oportunidade foi vinculada a esta conversa.</p>}</section><section><h3>Canais disponíveis</h3><a className="wa-contact-action" href={'tel:' + recipientPhone.replace(/[^\d+]/g, '')}><Phone size={16}/><span>Ligar pelo telefone<small>Usa o discador do dispositivo</small></span><ArrowUpRight size={14}/></a><div className="wa-contact-disabled"><Phone size={16}/><span>Ligação pelo WhatsApp<small>Depende da disponibilidade da Meta</small></span></div></section></> : <div className="wa-context-placeholder">Selecione um contato para consultar a oportunidade e os canais disponíveis.</div>}</aside>
  </div>;
}

export function WhatsAppMessageView({ message }: { message: Message }) {
  const outbound = message.direction === 'outbound';
  return <article className={'wa-message ' + (outbound ? 'outbound' : 'inbound')}><div className="wa-message-bubble"><p>{message.body || mediaLabel[message.kind]}</p><footer><time dateTime={message.occurred_at}>{new Date(message.occurred_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>{outbound && <span>{message.delivery_status === 'failed' ? 'Falhou' : message.delivery_status === 'read' ? 'Lida' : message.delivery_status === 'delivered' ? 'Entregue' : message.delivery_status === 'sent' ? 'Enviada' : 'Pendente'}</span>}</footer></div></article>;
}
