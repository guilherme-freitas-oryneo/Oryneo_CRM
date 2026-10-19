import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckoutConfigurator, parseCheckoutPrefill } from './CheckoutConfigurator';

describe('CheckoutConfigurator', () => {
  it('recalcula a seleção escolhida e só habilita a continuação com os dados mínimos', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<CheckoutConfigurator onContinue={onContinue}/>);

    expect(screen.getByText(/1\.739,80/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Plano Start/i }));
    await user.click(screen.getByRole('radio', { name: /Mensal/i }));
    await user.click(screen.getByRole('checkbox', { name: /Landing page de conversão/i }));
    expect(screen.getByText(/2\.629,70/)).toBeInTheDocument();

    const button = screen.getByRole('button', { name: 'Continuar para o pagamento' });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Nome completo'), 'Marina Costa');
    await user.type(screen.getByLabelText('E-mail corporativo'), 'marina@acme.example');
    await user.type(screen.getByLabelText('Empresa'), 'Acme Comércio');
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onContinue).toHaveBeenCalledWith({
      plan: 'Start', cycle: 'monthly', addons: ['landing-page'],
      customer_name: 'Marina Costa', customer_email: 'marina@acme.example', company: 'Acme Comércio',
    });
  });

  it('explica a recorrência separada de tráfego sem misturar verba de mídia ao total', async () => {
    const user = userEvent.setup();
    render(<CheckoutConfigurator onContinue={vi.fn()}/>);
    await user.click(screen.getByRole('checkbox', { name: /Gestão de tráfego pago/i }));
    expect(screen.getAllByText(/Primeiros 3 meses antecipados/)).toHaveLength(2);
    expect(screen.getByText(/Verba de mídia não está incluída/)).toBeInTheDocument();
    expect(screen.getByText(/a cada 3 meses após o período inicial/)).toBeInTheDocument();
  });
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('seleção vinda da landing page', () => {
  it('preserva plano, ciclo e adicionais sem aceitar repetidos', async () => {
    expect(parseCheckoutPrefill('?plan=Scale&cycle=annual&services=traffic&services=landing-page&services=traffic'))
      .toEqual({plan:'Scale',cycle:'annual',addons:['traffic','landing-page']});
    window.history.replaceState({}, '', '/contratar/?plan=Scale&cycle=annual&services=traffic&services=landing-page');
    render(<CheckoutConfigurator onContinue={vi.fn()}/>);
    expect(screen.getByRole('radio',{name:/Plano Scale/i})).toBeChecked();
    expect(screen.getByRole('radio',{name:/Anual/i})).toBeChecked();
    expect(screen.getByRole('checkbox',{name:/Landing page de conversão/i})).toBeChecked();
    expect(screen.getByRole('checkbox',{name:/Gestão de tráfego pago/i})).toBeChecked();
    expect(screen.getByText(/18\.427,52/)).toBeInTheDocument();
  });

  it('descarta códigos não suportados e ignora preços enviados pela URL', () => {
    expect(parseCheckoutPrefill('?plan=INVALID&cycle=weekly&services=hacker&services=traffic&amount=0&price=1'))
      .toEqual({plan:'Start',cycle:'monthly',addons:['traffic']});
  });
});
