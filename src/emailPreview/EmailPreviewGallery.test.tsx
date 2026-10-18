import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EmailPreviewGallery } from './EmailPreviewGallery';

describe('EmailPreviewGallery', () => {
  it('permite revisar cenários, HTML e texto simples em desktop e mobile', async () => {
    const user = userEvent.setup();
    render(<EmailPreviewGallery />);

    expect(screen.getByRole('heading', { name: 'Comunicações ORYNEO' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /cenário/i })).toHaveLength(24);
    expect(screen.getByTitle(/Prévia/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(screen.getByTestId('email-frame-shell')).toHaveClass('is-mobile');

    await user.click(screen.getByRole('button', { name: 'Comercial' }));
    await user.click(screen.getByRole('button', { name: 'Texto simples' }));
    expect(screen.getByText(/Olá, Rafael\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^cenário 2:/i }));
    expect(screen.getByText('Próximo passo da sua solicitação — ORYNEO')).toBeInTheDocument();
  });
});
