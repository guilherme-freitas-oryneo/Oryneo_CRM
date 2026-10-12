import { render, screen } from '@testing-library/react';
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
