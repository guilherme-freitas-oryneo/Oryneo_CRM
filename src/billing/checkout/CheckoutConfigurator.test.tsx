import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckoutConfigurator, parseCheckoutPrefill } from './CheckoutConfigurator';

describe('CheckoutConfigurator', () => {
  it('recalcula a seleção escolhida e só habilita a continuação com os dados mínimos', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<CheckoutConfigurator onContinue={onContinue}/>);

    expect(screen.getAllByText(/1\.739,80/).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Plano e periodicidade selecionados' })).toHaveTextContent('ORYNEO Start');
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    await user.click(screen.getByRole('checkbox', { name: /Landing page de conversão/i }));
    expect(screen.getAllByText(/2\.629,70/).length).toBeGreaterThan(0);

    const button = screen.getByRole('button', { name: /Continuar para o pagamento/ });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Nome completo'), 'Marina Costa');
    await user.type(screen.getByLabelText('E-mail corporativo'), 'marina@acme.example');
    await user.type(screen.getByLabelText('Empresa'), 'Acme Comércio');
    await user.type(screen.getByLabelText('CPF ou CNPJ'), '52998224725');
    expect(button).toBeDisabled();
    await user.click(screen.getByRole('checkbox',{name:/Li e aceito os termos/}));
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onContinue).toHaveBeenCalledWith({
      plan: 'Start', cycle: 'monthly', addons: ['landing-page'],
      payment_method:'card',card_funding:'credit',
      customer_name: 'Marina Costa', customer_email: 'marina@acme.example', company: 'Acme Comércio', tax_id:'52998224725',
    });
  });

  it('apresenta os quatro ativos aprovados de pagamento, sem ícones genéricos', async () => {
    const {container} = render(<CheckoutConfigurator onContinue={vi.fn()}/>);
    const methods = container.querySelectorAll('.checkout-payment-options label');
    expect(methods).toHaveLength(4);
    expect(methods[0]?.querySelectorAll('.checkout-payment-art img')).toHaveLength(2);
    expect(methods[1]?.querySelectorAll('.checkout-payment-art img')).toHaveLength(2);
    expect(methods[2]?.querySelectorAll('.checkout-payment-art img')).toHaveLength(1);
    expect(methods[3]?.querySelectorAll('.checkout-payment-art img')).toHaveLength(1);
    const images = [...container.querySelectorAll<HTMLImageElement>('.checkout-payment-art img')];
    expect(images).toHaveLength(6);
    for(const image of images){
      expect(image.src).toMatch(/^data:image\/png;base64,/);
      expect(image.alt).toBe('');
    }
    expect(screen.queryByText('Seu pagamento via Pix')).not.toBeInTheDocument();
  });

  it('explica a recorrência separada de tráfego sem misturar verba de mídia ao total', async () => {
    const user = userEvent.setup();
    render(<CheckoutConfigurator onContinue={vi.fn()}/>);
    await user.click(screen.getByRole('checkbox', { name: /Gestão de tráfego pago/i }));
    expect(screen.getAllByText(/Primeiros 3 meses antecipados/)).toHaveLength(2);
    expect(screen.getByText(/Verba de mídia não está incluída/)).toBeInTheDocument();
    expect(screen.getByText(/a cada 3 meses após o período inicial/)).toBeInTheDocument();
  });

  it('separa implantação, valor inicial de tráfego e renovação trimestral no resumo', async () => {
    const user = userEvent.setup();
    render(<CheckoutConfigurator onContinue={vi.fn()}/>);
    await user.click(screen.getByRole('checkbox', { name: /Gestão de tráfego pago/i }));

    const quote = screen.getByRole('complementary');
    expect(quote).toHaveTextContent('Implantação');
    expect(quote).toHaveTextContent('Primeiros 3 meses antecipados');
    expect(quote).toHaveTextContent('a cada 3 meses após o período inicial');
    expect(quote).toHaveTextContent('Verba de mídia não está incluída');
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
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('checkbox',{name:/Landing page de conversão/i})).toBeChecked();
    expect(screen.getByRole('checkbox',{name:/Gestão de tráfego pago/i})).toBeChecked();
    expect(screen.getAllByText(/21\.692,42/).length).toBeGreaterThan(0);
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
    expect(screen.getAllByRole('radio')).toHaveLength(4);
    expect(screen.getByRole('region',{name:'Plano e periodicidade selecionados'})).toHaveTextContent('ORYNEO Growth');
    expect(screen.queryByRole('link',{name:'página de planos'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox',{name:/Landing page de conversão/i}));
    await user.type(screen.getByLabelText('Nome completo'),'Marina Costa');
    await user.type(screen.getByLabelText('E-mail corporativo'),'marina@acme.example');
    await user.type(screen.getByLabelText('Empresa'),'Acme');
    await user.type(screen.getByLabelText('CPF ou CNPJ'),'52998224725');
    await user.click(screen.getByRole('checkbox',{name:/Li e aceito os termos/}));
    await user.click(screen.getByRole('button',{name:/Continuar para o pagamento/}));
    expect(onContinue).toHaveBeenCalledWith({
      plan:'Growth',cycle:'annual',addons:['landing-page'],
      payment_method:'card',card_funding:'credit',
      customer_name:'Marina Costa',customer_email:'marina@acme.example',company:'Acme',tax_id:'52998224725',
    });
  });

  it('applies the selected debit option before preparing checkout',async()=>{
    window.history.replaceState({}, '', '/contratar/?plan=Growth&cycle=monthly');
    const onContinue=vi.fn(),user=userEvent.setup();
    render(<CheckoutConfigurator onContinue={onContinue}/>);
    await user.click(screen.getByRole('radio',{name:/Cartão de débito/}));
    await user.type(screen.getByLabelText('Nome completo'),'Marina Costa');
    await user.type(screen.getByLabelText('E-mail corporativo'),'marina@acme.example');
    await user.type(screen.getByLabelText('Empresa'),'Acme');
    await user.type(screen.getByLabelText('CPF ou CNPJ'),'52998224725');
    await user.click(screen.getByRole('checkbox',{name:/Li e aceito os termos/}));
    await user.click(screen.getByRole('button',{name:/Continuar para o pagamento/}));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({payment_method:'card',card_funding:'debit'}));
  });

  it('offers boleto recurring invoices with manual payment per period',async()=>{
    const onContinue=vi.fn(),user=userEvent.setup();
    render(<CheckoutConfigurator onContinue={onContinue}/>);
    await user.click(screen.getByRole('radio',{name:/Boleto bancário/}));
    expect(screen.getByText(/Fatura enviada por e-mail a cada período/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nome completo'),'Marina Costa');
    await user.type(screen.getByLabelText('E-mail corporativo'),'marina@acme.example');
    await user.type(screen.getByLabelText('Empresa'),'Acme');
    await user.type(screen.getByLabelText('CPF ou CNPJ'),'52998224725');
    await user.click(screen.getByRole('checkbox',{name:/Li e aceito os termos/}));
    await user.click(screen.getByRole('button',{name:/Continuar para o pagamento/}));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({payment_method:'boleto'}));
  });
});


describe('jornada Pix guiada', () => {
  it('exibe orientação contextual sem alterar plano, valores ou cobrar na seleção', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<CheckoutConfigurator onContinue={onContinue}/>);
    const initialTotal = screen.getAllByText(/1\.739,80/).length;
    await user.click(screen.getByRole('radio', { name: /Pix/ }));
    expect(screen.queryByText('Seu pagamento via Pix')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox',{name:/Li e aceito os termos/})).not.toBeChecked();
    expect(screen.getByRole('button', { name: /Continuar para o Pix/ })).toBeDisabled();
    expect(screen.getAllByText(/1\.739,80/).length).toBeGreaterThanOrEqual(initialTotal);
    expect(onContinue).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Nome completo'), 'Marina Costa');
    await user.type(screen.getByLabelText('E-mail corporativo'), 'marina@acme.example');
    await user.type(screen.getByLabelText('Empresa'), 'Acme Comércio');
    await user.type(screen.getByLabelText('CPF ou CNPJ'), '52998224725');
    await user.click(screen.getByRole('checkbox',{name:/Li e aceito os termos/}));
    await user.click(screen.getByRole('button', { name: /Continuar para o Pix/ }));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ payment_method: 'pix', tax_id: '52998224725' }));
  });
});
