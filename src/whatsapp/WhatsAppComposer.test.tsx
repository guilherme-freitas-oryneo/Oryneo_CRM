import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WhatsAppComposer } from './WhatsAppComposer';

describe('WhatsAppComposer', () => {
  it('mantém ações bloqueadas enquanto não há rota de envio', async () => {
    const onSend = vi.fn();
    render(<WhatsAppComposer enabled={false} disabledReason="Canal indisponível" onSend={onSend}/>);
    expect(screen.getByRole('status')).toHaveTextContent('Canal indisponível');
    expect(screen.getByRole('textbox', { name: 'Mensagem' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gravar áudio' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anexar arquivo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('envia texto apenas após a confirmação da rota e mantém o rascunho em falha', async () => {
    const onSend = vi.fn().mockRejectedValueOnce(new Error('Falha do servidor')).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<WhatsAppComposer enabled disabledReason="" onSend={onSend}/>);
    const textbox = screen.getByRole('textbox', { name: 'Mensagem' });
    await user.type(textbox, 'Olá, Marina');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha do servidor');
    expect(textbox).toHaveValue('Olá, Marina');
    await user.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(onSend).toHaveBeenCalledWith({ kind: 'text', text: 'Olá, Marina' });
    expect(textbox).toHaveValue('');
  });

  it('mostra e cancela a mensagem citada sem apagar o rascunho', async () => {
    const onCancelReply = vi.fn();
    const user = userEvent.setup();
    render(<WhatsAppComposer enabled disabledReason="" replyPreview="Olá" onCancelReply={onCancelReply} onSend={vi.fn()}/>);
    await user.type(screen.getByRole('textbox', { name: 'Mensagem' }), 'Resposta');
    expect(screen.getByText('Respondendo a: Olá')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar resposta' }));
    expect(onCancelReply).toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Mensagem' })).toHaveValue('Resposta');
  });
});
