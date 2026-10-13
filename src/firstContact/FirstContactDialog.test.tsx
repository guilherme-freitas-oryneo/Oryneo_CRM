import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DealRow } from '../data';
import { FirstContactDialog } from './FirstContactDialog';
import { sendFirstContact } from './api';

vi.mock('./api', () => ({ sendFirstContact: vi.fn() }));

const deal: DealRow = {
  id: '11111111-1111-4111-8111-111111111111', kind: 'deal', revision: 1, deleted: false,
  created_at: '2026-10-13T10:00:00Z', updated_at: '2026-10-13T10:00:00Z',
  data: {
    title: 'Solicitação · Aurora', company: 'Aurora Clínica', contact: 'Marina Souza', email: 'marina@aurora.example', phone: '(11) 99999-8888',
    value_cents: 0, stage_id: '87f1e31e-3912-40b0-9284-c6805c84dafe', notes: '', source: 'Landing page', due_date: '',
    quote: { plan: 'Growth', cycle: 'annual', monthly_cents: 0, period_cents: 0, setup_cents: 0, first_charge_cents: 0, users: 10, catalog_version: 'test', addons: [{ key: 'traffic', label: 'Tráfego', billing: 'monthly', amount_cents: 0, upfront_cents: 0 }] },
    form_submission: { intent: 'conversation', goals: ['Acompanhar resultados e gestão'], primary_goal: 'Acompanhar resultados e gestão', acquisition_channels: ['Google'], primary_acquisition_channel: 'Google' },
  },
};

describe('FirstContactDialog', () => {
  beforeEach(() => vi.mocked(sendFirstContact).mockReset());
  it('mostra destinatário, assunto e alternativas HTML/texto antes da confirmação', async () => {
    render(<FirstContactDialog deal={deal} onClose={vi.fn()} onSent={vi.fn()}/>);
    expect(screen.getByText('marina@aurora.example')).toBeInTheDocument();
    expect(screen.getByText('Sua solicitação na ORYNEO')).toBeInTheDocument();
    const frame = screen.getByTitle('Prévia HTML do primeiro e-mail');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc')).toContain('oryneo-wordmark-mono.png');
    await userEvent.click(screen.getByRole('button', { name: 'Ver versão em texto' }));
    expect(screen.getByText(/Olá, Marina\./)).toBeInTheDocument();
  });

  it('confirma apenas uma vez sob duplo clique e atualiza após sucesso', async () => {
    vi.mocked(sendFirstContact).mockResolvedValue({ internetMessageId: '<id@oryneo.com.br>', alreadyAccepted: false, sentAt: '2026-10-13T12:00:00Z' });
    const onSent = vi.fn().mockResolvedValue(undefined);
    render(<FirstContactDialog deal={deal} onClose={vi.fn()} onSent={onSent}/>);
    await userEvent.dblClick(screen.getByRole('button', { name: 'Confirmar e enviar e-mail' }));
    expect(sendFirstContact).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it('mantém a mesma chave no retry e não exibe falso sucesso', async () => {
    vi.mocked(sendFirstContact).mockRejectedValueOnce(new Error('Falha temporária')).mockResolvedValueOnce({ internetMessageId: '<id@oryneo.com.br>', alreadyAccepted: true, sentAt: '2026-10-13T12:00:00Z' });
    render(<FirstContactDialog deal={deal} onClose={vi.fn()} onSent={vi.fn()}/>);
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e enviar e-mail' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha temporária');
    expect(screen.queryByText('E-mail enviado.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar envio novamente' }));
    expect(sendFirstContact).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendFirstContact).mock.calls[0][0].idempotencyKey).toBe(vi.mocked(sendFirstContact).mock.calls[1][0].idempotencyKey);
  });

  it('sinaliza reenvio explícito nos detalhes', async () => {
    vi.mocked(sendFirstContact).mockResolvedValue({ internetMessageId: '<new@oryneo.com.br>', alreadyAccepted: false, sentAt: '2026-10-13T12:00:00Z' });
    render(<FirstContactDialog deal={deal} resend onClose={vi.fn()} onSent={vi.fn()}/>);
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar reenvio de e-mail' }));
    expect(sendFirstContact).toHaveBeenCalledWith(expect.objectContaining({ dealId: deal.id, resend: true }));
  });
});
