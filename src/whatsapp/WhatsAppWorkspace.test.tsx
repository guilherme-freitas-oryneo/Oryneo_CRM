import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DealRow } from '../data';
import { WhatsAppWorkspace } from './WhatsAppWorkspace';

const deal: DealRow = {
  id: '11111111-1111-4111-8111-111111111111', kind: 'deal', revision: 1, deleted: false,
  created_at: '2026-10-13T10:00:00Z', updated_at: '2026-10-13T10:00:00Z',
  data: { title: 'Diagnóstico Aurora', company: 'Aurora', contact: 'Marina', email: '', phone: '(11) 99999-8888', value_cents: 0, stage_id: 'stage', notes: '', source: 'Landing page', due_date: '' },
};

describe('WhatsAppWorkspace', () => {
  it('mostra contato real e contexto sem criar conversa fictícia ou habilitar envio', async () => {
    const onOpenDeal = vi.fn();
    render(<WhatsAppWorkspace deals={[deal]} loading={false} loadError="" onOpenDeal={onOpenDeal}/>);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir contato Marina' }));
    expect(screen.getByText('Conversa ainda não conectada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar mensagem indisponível' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Gravar áudio indisponível' })).toBeDisabled();
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
});
