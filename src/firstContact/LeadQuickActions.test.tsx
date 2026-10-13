import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DealRow, StageRow } from '../data';
import { LeadQuickActions } from './LeadQuickActions';

const firstStage: StageRow = {
  id: '87f1e31e-3912-40b0-9284-c6805c84dafe', kind: 'stage', revision: 1, deleted: false,
  created_at: '2026-10-13T10:00:00Z', updated_at: '2026-10-13T10:00:00Z',
  data: { name: 'Diagnóstico pendente', color: '#456', position: 1, outcome: 'open' },
};
const deal: DealRow = {
  id: '11111111-1111-4111-8111-111111111111', kind: 'deal', revision: 1, deleted: false,
  created_at: '2026-10-13T10:00:00Z', updated_at: '2026-10-13T10:00:00Z',
  data: {
    title: 'Solicitação · Aurora', company: 'Aurora', contact: 'Marina', email: 'marina@aurora.example',
    phone: '(11) 99999-8888', value_cents: 0, stage_id: firstStage.id, notes: '', source: 'Landing page', due_date: '',
  },
};

describe('LeadQuickActions', () => {
  it('oferece prévia de e-mail e WhatsApp somente no diagnóstico pendente', async () => {
    const onPreview = vi.fn(), onOpenWhatsApp = vi.fn();
    render(<LeadQuickActions deal={deal} stage={firstStage} onPreview={onPreview} onOpenWhatsApp={onOpenWhatsApp}/>);
    await userEvent.click(screen.getByRole('button', { name: 'Revisar primeiro e-mail' }));
    await userEvent.click(screen.getByRole('button', { name: 'Abrir WhatsApp de Marina' }));
    expect(onPreview).toHaveBeenCalledWith(deal);
    expect(onOpenWhatsApp).toHaveBeenCalledWith('https://wa.me/5511999998888');
  });

  it('não aparece em outra etapa', () => {
    render(<LeadQuickActions deal={deal} stage={{ ...firstStage, id: 'other-stage' }} onPreview={vi.fn()} onOpenWhatsApp={vi.fn()}/>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('omite cada ação quando o dado necessário não é válido', () => {
    const invalid = { ...deal, data: { ...deal.data, email: 'invalido', phone: '123' } };
    render(<LeadQuickActions deal={invalid} stage={firstStage} onPreview={vi.fn()} onOpenWhatsApp={vi.fn()}/>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('troca envio por selo datado após o primeiro contato e mantém WhatsApp', () => {
    const contacted = { ...deal, data: { ...deal.data, first_contact: { sent_at: '2026-10-13T12:34:00Z', internet_message_id: '<id@oryneo.com.br>', idempotency_key: 'key' } } };
    render(<LeadQuickActions deal={contacted} stage={firstStage} onPreview={vi.fn()} onOpenWhatsApp={vi.fn()}/>);
    expect(screen.queryByRole('button', { name: 'Revisar primeiro e-mail' })).not.toBeInTheDocument();
    expect(screen.getByText(/e-mail enviado/i)).toHaveAttribute('title', expect.stringContaining('13/10/2026'));
    expect(screen.getByRole('button', { name: 'Abrir WhatsApp de Marina' })).toBeInTheDocument();
  });
});
