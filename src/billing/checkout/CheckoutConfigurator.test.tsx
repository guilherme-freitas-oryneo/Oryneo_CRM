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
    expect(screen.getByRole('region', { name: 'Plano e periodicidade selecionados' })).toHaveTextContent('ORYNEO Start');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
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
    const locked = screen.getByRole('region',{name:'Plano e periodicidade selecionados'});
    expect(locked).toHaveTextContent('ORYNEO Scale');
    expect(locked).toHaveTextContent('Anual');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox',{name:/Landing page de conversão/i})).toBeChecked();
    expect(screen.getByRole('checkbox',{name:/Gestão de tráfego pago/i})).toBeChecked();
    expect(screen.getByText(/21\.692,42/)).toBeInTheDocument();
  });

  it('descarta códigos não suportados e ignora preços enviados pela URL', () => {
    expect(parseCheckoutPrefill('?plan=INVALID&cycle=weekly&services=hacker&services=traffic&amount=0&price=1'))
      .toEqual({plan:'Start',cycle:'monthly',addons:['traffic']});
  });
});

describe('checkout não permite alterar o plano nem a periodicidade', () => {
  it('mantém Growth anual fixo e permite somente adicionais e dados do pedido', async () => {
    window.history.replaceState({}, '', '/contratar/?plan=Growth&cycle=annual');
    const onContinue = vi.fn();
    const user = userEvent.setup();
    render(<CheckoutConfigurator onContinue={onContinue}/>);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('region',{name:'Plano e periodicidade selecionados'})).toHaveTextContent('ORYNEO Growth');
    expect(screen.getByRole('link',{name:'página de planos'})).toHaveAttribute('href','https://oryneo.com.br/');
    await user.click(screen.getByRole('checkbox',{name:/Landing page de conversão/i}));
    await user.type(screen.getByLabelText('Nome completo'),'Marina Costa');
    await user.type(screen.getByLabelText('E-mail corporativo'),'marina@acme.example');
    await user.type(screen.getByLabelText('Empresa'),'Acme');
    await user.click(screen.getByRole('button',{name:'Continuar para o pagamento'}));
    expect(onContinue).toHaveBeenCalledWith({
      plan:'Growth',cycle:'annual',addons:['landing-page'],
      customer_name:'Marina Costa',customer_email:'marina@acme.example',company:'Acme',
    });
  });
});
