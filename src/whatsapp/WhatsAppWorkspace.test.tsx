import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DealRow } from '../data';
import { deleteWhatsAppMessageForMe, loadWhatsAppInbox, loadWhatsAppMedia, loadWhatsAppMessages, markWhatsAppRead, sendWhatsAppMessage, sendWhatsAppReaction, setWhatsAppAutomation } from './api';
import { WhatsAppMessageView, WhatsAppWorkspace } from './WhatsAppWorkspace';

vi.mock('./api', () => ({ loadWhatsAppInbox: vi.fn(), loadWhatsAppMessages: vi.fn(), loadWhatsAppMedia: vi.fn(), markWhatsAppRead: vi.fn(), sendWhatsAppMessage: vi.fn(), sendWhatsAppReaction: vi.fn(), deleteWhatsAppMessageForMe: vi.fn(), setWhatsAppAutomation: vi.fn() }));

const deal: DealRow = {
  id: '11111111-1111-4111-8111-111111111111', kind: 'deal', revision: 1, deleted: false,
  created_at: '2026-10-13T10:00:00Z', updated_at: '2026-10-13T10:00:00Z',
  data: { title: 'Diagnóstico Aurora', company: 'Aurora', contact: 'Marina', email: '', phone: '(11) 99999-8888', value_cents: 0, stage_id: 'stage', notes: '', source: 'Landing page', due_date: '' },
};

describe('WhatsAppWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({ channel: { id: 'channel-1', enabled: false, display_phone_number: '+5521974510932' }, conversations: [] });
    vi.mocked(loadWhatsAppMessages).mockResolvedValue([]);
    vi.mocked(loadWhatsAppMedia).mockResolvedValue(new Blob(['image'], { type: 'image/jpeg' }));
    vi.mocked(markWhatsAppRead).mockResolvedValue();
    vi.mocked(sendWhatsAppReaction).mockResolvedValue('wamid.reaction');
    vi.mocked(deleteWhatsAppMessageForMe).mockResolvedValue();
    vi.mocked(setWhatsAppAutomation).mockResolvedValue({ mode: 'review', consentGranted: false, jobEnqueued: false });
  });
  it('mostra contato real e contexto sem criar conversa fictícia ou habilitar envio', async () => {
    const onOpenDeal = vi.fn();
    render(<WhatsAppWorkspace deals={[deal]} loading={false} loadError="" onOpenDeal={onOpenDeal}/>);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir contato Marina' }));
    expect(screen.getByText('Conversa ainda não conectada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gravar áudio' })).toBeDisabled();
    expect(screen.getByRole('link', { name: /Abrir WhatsApp externo/ })).toHaveAttribute('href', 'https://wa.me/5511999998888');
    expect(screen.getByRole('link', { name: /Ligar pelo telefone/ })).toHaveAttribute('href', 'tel:11999998888');
    await userEvent.click(screen.getByRole('button', { name: /Abrir no pipeline/ }));
    expect(onOpenDeal).toHaveBeenCalledWith(deal.id);
  });

  it('distingue falha de carregamento de uma lista vazia', () => {
    render(<WhatsAppWorkspace deals={[]} loading={false} loadError="Falha de rede" onOpenDeal={vi.fn()}/>);
    expect(screen.getByRole('alert')).toHaveTextContent('Falha de rede');
    expect(screen.queryByText('Nenhum contato com telefone')).not.toBeInTheDocument();
  });

  it('só autoriza envio na janela com canal habilitado e confirma pela função real', async () => {
    const now = new Date().toISOString();
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({
      channel: { id: 'channel-1', enabled: true, display_phone_number: '+5521974510932' },
      conversations: [{
        id: 'conversation-1', channel_id: 'channel-1', customer_wa_id: '5511999998888',
        customer_name: 'Marina', deal_id: null, mode: 'review', opted_out: false,
        consent_granted: true, last_inbound_at: now, last_message_at: now, last_preview: 'Olá',
      }],
    });
    vi.mocked(sendWhatsAppMessage).mockResolvedValue('wamid.123');
    render(<WhatsAppWorkspace deals={[deal]} loading={false} loadError="" onOpenDeal={vi.fn()}/>);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Abrir conversa de Marina' }));
    const box = screen.getByRole('textbox', { name: 'Mensagem' });
    expect(box).toBeEnabled();
    await user.type(box, 'Olá, Marina');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('conversation-1', { kind: 'text', text: 'Olá, Marina' }, expect.stringMatching(/^[0-9a-f-]{36}$/i));
  });

  it('impede envio para contato que pediu opt-out, mesmo com canal habilitado', async () => {
    const now = new Date().toISOString();
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({
      channel: { id: 'channel-1', enabled: true, display_phone_number: '+5521974510932' },
      conversations: [{
        id: 'conversation-1', channel_id: 'channel-1', customer_wa_id: '5511999998888',
        customer_name: 'Marina', deal_id: null, mode: 'review', opted_out: true,
        consent_granted: true, last_inbound_at: now, last_message_at: now, last_preview: 'Pare',
      }],
    });
    render(<WhatsAppWorkspace deals={[deal]} loading={false} loadError="" onOpenDeal={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir conversa de Marina' }));
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    expect(sendWhatsAppMessage).not.toHaveBeenCalled();
  });

  it('ativa o SDR somente após confirmar consentimento e atualiza o estado da conversa', async () => {
    const now = new Date().toISOString();
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({
      channel: { id: 'channel-1', enabled: true, display_phone_number: '+5521974510932' },
      conversations: [{ id: 'conversation-1', channel_id: 'channel-1', customer_wa_id: '5511999998888', customer_name: 'Marina', deal_id: null, mode: 'review', opted_out: false, consent_granted: false, last_inbound_at: now, last_message_at: now, last_preview: 'Oi' }],
    });
    vi.mocked(setWhatsAppAutomation).mockResolvedValue({ mode: 'sdr_active', consentGranted: true, jobEnqueued: true });
    const user = userEvent.setup();
    render(<WhatsAppWorkspace deals={[]} loading={false} loadError="" onOpenDeal={vi.fn()}/>);
    await user.click(await screen.findByRole('button', { name: 'Abrir conversa de Marina' }));
    await user.click(screen.getByRole('button', { name: 'Ativar SDR' }));
    expect(screen.getByText(/contato autorizou o atendimento automatizado/i)).toBeInTheDocument();
    expect(setWhatsAppAutomation).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmo e ativar' }));
    expect(setWhatsAppAutomation).toHaveBeenCalledWith('conversation-1', true, true);
    expect(await screen.findByRole('button', { name: 'Pausar SDR' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('pausa o SDR imediatamente e preserva o controle na conversa', async () => {
    const now = new Date().toISOString();
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({
      channel: { id: 'channel-1', enabled: true, display_phone_number: '+5521974510932' },
      conversations: [{ id: 'conversation-1', channel_id: 'channel-1', customer_wa_id: '5511999998888', customer_name: 'Marina', deal_id: null, mode: 'sdr_active', opted_out: false, consent_granted: true, last_inbound_at: now, last_message_at: now, last_preview: 'Oi' }],
    });
    vi.mocked(setWhatsAppAutomation).mockResolvedValue({ mode: 'review', consentGranted: true, jobEnqueued: false });
    const user = userEvent.setup();
    render(<WhatsAppWorkspace deals={[]} loading={false} loadError="" onOpenDeal={vi.fn()}/>);
    await user.click(await screen.findByRole('button', { name: 'Abrir conversa de Marina' }));
    await user.click(screen.getByRole('button', { name: 'Pausar SDR' }));
    expect(setWhatsAppAutomation).toHaveBeenCalledWith('conversation-1', false, false);
    expect(await screen.findByRole('button', { name: 'Ativar SDR' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('mantém o SDR bloqueado quando o contato optou por não receber mensagens', async () => {
    const now = new Date().toISOString();
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({
      channel: { id: 'channel-1', enabled: true, display_phone_number: '+5521974510932' },
      conversations: [{ id: 'conversation-1', channel_id: 'channel-1', customer_wa_id: '5511999998888', customer_name: 'Marina', deal_id: null, mode: 'review', opted_out: true, consent_granted: false, last_inbound_at: now, last_message_at: now, last_preview: 'Pare' }],
    });
    render(<WhatsAppWorkspace deals={[]} loading={false} loadError="" onOpenDeal={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir conversa de Marina' }));
    expect(screen.getByRole('button', { name: 'SDR bloqueado' })).toBeDisabled();
  });

  it('mostra falha do backend e não altera visualmente o estado do SDR', async () => {
    const now = new Date().toISOString();
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({
      channel: { id: 'channel-1', enabled: true, display_phone_number: '+5521974510932' },
      conversations: [{ id: 'conversation-1', channel_id: 'channel-1', customer_wa_id: '5511999998888', customer_name: 'Marina', deal_id: null, mode: 'review', opted_out: false, consent_granted: false, last_inbound_at: now, last_message_at: now, last_preview: 'Oi' }],
    });
    vi.mocked(setWhatsAppAutomation).mockRejectedValue(new Error('Sem permissão para alterar o SDR.'));
    const user = userEvent.setup();
    render(<WhatsAppWorkspace deals={[]} loading={false} loadError="" onOpenDeal={vi.fn()}/>);
    await user.click(await screen.findByRole('button', { name: 'Abrir conversa de Marina' }));
    await user.click(screen.getByRole('button', { name: 'Ativar SDR' }));
    await user.click(screen.getByRole('button', { name: 'Confirmo e ativar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão para alterar o SDR.');
    expect(screen.getByRole('button', { name: 'Ativar SDR' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('exibe mensagens recebidas sem inferir vínculo com oportunidade pelo telefone', async () => {
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({ channel: { id: 'channel-1', enabled: false, display_phone_number: '+5521974510932' }, conversations: [{ id: 'conversation-1', channel_id: 'channel-1', customer_wa_id: '5511999998888', customer_name: 'Marina', deal_id: null, mode: 'review', opted_out: false, consent_granted: false, last_message_at: '2026-10-24T16:40:00Z', last_preview: 'Olá' }] });
    vi.mocked(loadWhatsAppMessages).mockResolvedValue([{ id: 'message-1', conversation_id: 'conversation-1', direction: 'inbound', kind: 'text', body: 'Olá', media_id: null, mime_type: null, delivery_status: null, occurred_at: '2026-10-24T16:40:00Z' }]);
    render(<WhatsAppWorkspace deals={[deal]} loading={false} loadError="" onOpenDeal={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir conversa de Marina' }));
    expect(await screen.findByText('Olá', { selector: '.wa-message-bubble p' })).toBeInTheDocument();
    expect(screen.getByText('Nenhuma oportunidade foi vinculada a esta conversa.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enviar/ })).toBeDisabled();
  });

  it('mostra não lidas sem confirmar leitura na Meta enquanto o canal está desligado', async () => {
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({
      channel: { id: 'channel-1', enabled: false, display_phone_number: '+5521974510932' },
      conversations: [{ id: 'conversation-1', channel_id: 'channel-1', customer_wa_id: '5511999998888',
        customer_name: 'Marina', deal_id: null, mode: 'review', opted_out: false, consent_granted: false,
        last_inbound_at: new Date().toISOString(), last_message_at: new Date().toISOString(), last_preview: 'Olá', unread_count: 2 }],
    });
    render(<WhatsAppWorkspace deals={[]} loading={false} loadError="" onOpenDeal={vi.fn()}/>);
    expect(await screen.findByLabelText('2 mensagens não lidas')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir conversa de Marina' }));
    expect(markWhatsAppRead).not.toHaveBeenCalled();
  });

  it('responde citando, reage e oculta somente para o operador', async () => {
    const now = new Date().toISOString();
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({
      channel: { id: 'channel-1', enabled: true, display_phone_number: '+5521974510932' },
      conversations: [{ id: 'conversation-1', channel_id: 'channel-1', customer_wa_id: '5511999998888', customer_name: 'Marina', deal_id: null, mode: 'review', opted_out: false, consent_granted: true, last_inbound_at: now, last_message_at: now, last_preview: 'Olá' }],
    });
    vi.mocked(loadWhatsAppMessages).mockResolvedValue([{ id: 'message-1', provider_message_id: 'wamid.inbound', conversation_id: 'conversation-1', direction: 'inbound', kind: 'text', body: 'Olá', media_id: null, mime_type: null, delivery_status: null, occurred_at: now }]);
    vi.mocked(sendWhatsAppMessage).mockResolvedValue('wamid.reply');
    const user = userEvent.setup();
    render(<WhatsAppWorkspace deals={[]} loading={false} loadError="" onOpenDeal={vi.fn()}/>);
    await user.click(await screen.findByRole('button', { name: 'Abrir conversa de Marina' }));
    await screen.findByText('Olá', { selector: '.wa-message-bubble p' });
    await user.click(screen.getByRole('button', { name: 'Ações da mensagem' }));
    await user.click(screen.getByRole('button', { name: 'Responder à mensagem' }));
    expect(screen.getByText(/Respondendo a: Olá/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'Tudo certo');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(sendWhatsAppMessage).toHaveBeenCalledWith('conversation-1', { kind: 'text', text: 'Tudo certo' }, expect.any(String), 'message-1');
    await user.click(screen.getByRole('button', { name: 'Ações da mensagem' }));
    await user.click(screen.getByRole('button', { name: 'Reagir com 👍' }));
    expect(sendWhatsAppReaction).toHaveBeenCalledWith('conversation-1', 'message-1', '👍', expect.any(String));
    await user.click(screen.getByRole('button', { name: 'Ações da mensagem' }));
    await user.click(screen.getByRole('button', { name: 'Apagar para mim' }));
    expect(deleteWhatsAppMessageForMe).toHaveBeenCalledWith('conversation-1', 'message-1');
  });

  it('associa resposta e reação recebidas à foto original', async () => {
    const now = new Date().toISOString();
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({
      channel: { id: 'channel-1', enabled: true, display_phone_number: '+5521974510932' },
      conversations: [{ id: 'conversation-1', channel_id: 'channel-1', customer_wa_id: '5511999998888', customer_name: 'Marina', deal_id: null, mode: 'review', opted_out: false, consent_granted: true, last_inbound_at: now, last_message_at: now, last_preview: 'Mensagem responde à foto' }],
    });
    vi.mocked(loadWhatsAppMessages).mockResolvedValue([
      { id: 'photo-1', provider_message_id: 'wamid.photo', conversation_id: 'conversation-1', direction: 'inbound', kind: 'image', body: '', media_id: 'media-photo', mime_type: 'image/jpeg', delivery_status: null, occurred_at: '2026-10-28T10:21:34Z' },
      { id: 'reply-1', provider_message_id: 'wamid.reply', conversation_id: 'conversation-1', direction: 'inbound', kind: 'text', body: 'Mensagem responde à foto', media_id: null, mime_type: null, delivery_status: null, occurred_at: '2026-10-28T10:22:19Z', reply_to_provider_message_id: 'wamid.photo' },
      { id: 'reaction-1', provider_message_id: 'wamid.reaction', conversation_id: 'conversation-1', direction: 'inbound', kind: 'other', body: '', media_id: null, mime_type: null, delivery_status: null, occurred_at: '2026-10-28T10:22:29Z', reaction_to_provider_message_id: 'wamid.photo', reaction_emoji: '👏' },
    ]);
    render(<WhatsAppWorkspace deals={[]} loading={false} loadError="" onOpenDeal={vi.fn()}/>);
    await userEvent.click(await screen.findByRole('button', { name: 'Abrir conversa de Marina' }));
    expect(await screen.findByText('Mensagem responde à foto', { selector: '.wa-message-bubble p' })).toBeInTheDocument();
    expect(screen.getByText('Imagem recebida', { selector: '.wa-message-quote' })).toBeInTheDocument();
    expect(screen.getByText('👏', { selector: '.wa-message-reactions' })).toBeInTheDocument();
  });

  it('separa mensagens por data e identifica quem reagiu e quando', async () => {
    const now = new Date().toISOString();
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({
      channel: { id: 'channel-1', enabled: true, display_phone_number: '+5521974510932' },
      conversations: [{ id: 'conversation-1', channel_id: 'channel-1', customer_wa_id: '5511999998888', customer_name: 'Marina', deal_id: null, mode: 'review', opted_out: false, consent_granted: true, last_inbound_at: now, last_message_at: now, last_preview: 'Tudo certo' }],
    });
    vi.mocked(loadWhatsAppMessages).mockResolvedValue([
      { id: 'message-1', provider_message_id: 'wamid.message', conversation_id: 'conversation-1', direction: 'outbound', kind: 'text', body: 'Proposta enviada', media_id: null, mime_type: null, delivery_status: 'read', occurred_at: '2026-10-27T23:58:00Z' },
      { id: 'message-2', provider_message_id: 'wamid.reply', conversation_id: 'conversation-1', direction: 'inbound', kind: 'text', body: 'Tudo certo', media_id: null, mime_type: null, delivery_status: null, occurred_at: '2026-10-28T10:20:00Z' },
      { id: 'reaction-1', provider_message_id: 'wamid.reaction', conversation_id: 'conversation-1', direction: 'inbound', kind: 'other', body: '', media_id: null, mime_type: null, delivery_status: null, occurred_at: '2026-10-28T10:22:29Z', reaction_to_provider_message_id: 'wamid.message', reaction_emoji: '👏' },
    ]);
    const user = userEvent.setup();
    render(<WhatsAppWorkspace deals={[]} loading={false} loadError="" onOpenDeal={vi.fn()}/>);
    await user.click(await screen.findByRole('button', { name: 'Abrir conversa de Marina' }));
    expect(await screen.findByText('27 de outubro de 2026')).toBeInTheDocument();
    expect(screen.getByText('28 de outubro de 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver detalhes de 1 reação' }));
    expect(screen.getByText(/Marina reagiu com 👏/)).toBeInTheDocument();
    expect(screen.getByText(/28\/10\/2026, 07:22/)).toBeInTheDocument();
  });

  it('filtra a fila por não lidas, revisão e atendimento humano', async () => {
    const now = new Date().toISOString();
    vi.mocked(loadWhatsAppInbox).mockResolvedValue({
      channel: { id: 'channel-1', enabled: true, display_phone_number: '+5521974510932' },
      conversations: [
        { id: 'review-1', channel_id: 'channel-1', customer_wa_id: '5511111111111', customer_name: 'Ana', deal_id: null, mode: 'review', opted_out: false, consent_granted: true, last_inbound_at: now, last_message_at: now, last_preview: 'Preciso de ajuda', unread_count: 2 },
        { id: 'human-1', channel_id: 'channel-1', customer_wa_id: '5522222222222', customer_name: 'Bruno', deal_id: null, mode: 'human_locked', opted_out: false, consent_granted: true, last_inbound_at: now, last_message_at: now, last_preview: 'Obrigado', unread_count: 0 },
      ],
    });
    const user = userEvent.setup();
    render(<WhatsAppWorkspace deals={[]} loading={false} loadError="" onOpenDeal={vi.fn()}/>);
    expect(await screen.findByRole('button', { name: 'Abrir conversa de Ana' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir conversa de Bruno' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Não lidas' }));
    expect(screen.getByRole('button', { name: 'Abrir conversa de Ana' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Abrir conversa de Bruno' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Com atendente' }));
    expect(screen.queryByRole('button', { name: 'Abrir conversa de Ana' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir conversa de Bruno' })).toBeInTheDocument();
  });
});

describe('WhatsAppMessageView', () => {
  const message = {
    id: 'message-1', provider_message_id: 'wamid.1', conversation_id: 'conversation-1', direction: 'inbound' as const,
    kind: 'text' as const, body: 'Olá', media_id: null, mime_type: null, delivery_status: null,
    occurred_at: '2026-10-28T12:57:09Z',
  };

  it('keeps reactions and message actions hidden until the operator opens the actions menu', async () => {
    render(<WhatsAppMessageView message={message} canInteract onReply={vi.fn()} onReact={vi.fn()} onDelete={vi.fn()}/>);
    expect(screen.queryByRole('button', { name: 'Reagir com 👍' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Responder à mensagem' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ações da mensagem' }));
    expect(screen.getByRole('button', { name: 'Reagir com 👍' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Responder à mensagem' })).toBeInTheDocument();
  });
});
