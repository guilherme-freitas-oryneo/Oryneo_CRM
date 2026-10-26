import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckoutConfigurator, parseCheckoutPrefill } from './CheckoutConfigurator';

describe('CheckoutConfigurator', () => {
  it('recupera a consulta indisponível sem alterar os dados e não cria rascunho vazio', async () => {
    const user=userEvent.setup();
    const onDraft=vi.fn().mockResolvedValueOnce({cnpj_status:'unavailable'}).mockResolvedValue({cnpj_status:'found',company:{legal_name:'Empresa teste'}});
    render(<CheckoutConfigurator onContinue={vi.fn()} onDraft={onDraft}/>);
    expect(screen.getByText(/salvos automaticamente como rascunho/)).toBeInTheDocument();
    expect(onDraft).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('CNPJ'),'11222333000181');
    await user.click(await screen.findByRole('button',{name:'Tentar consultar CNPJ novamente'}));
    expect(await screen.findByText('Empresa identificada: Empresa teste')).toBeInTheDocument();
    expect(screen.getByLabelText('CNPJ')).toHaveValue('11.222.333/0001-81');
    expect(onDraft).toHaveBeenCalledTimes(2);
  });

  it('recalcula a seleção escolhida e só habilita a continuação com os dados mínimos', async () => {
    const user = userEvent.setup();
    const onContinue = vi.fn();
    render(<CheckoutConfigurator onContinue={onContinue}/>);

    expect(screen.getAllByText(/1\.739,80/).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Plano e periodicidade selecionados' })).toHaveTextContent('ORYNEO Start');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Cartão' })).not.toBeChecked();
    expect(screen.queryByRole('radiogroup', { name: 'Tipo do cartão' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Landing page de conversão/i }));
    expect(screen.getAllByText(/2\.629,70/).length).toBeGreaterThan(0);

    const button = screen.getByRole('button', { name: /Continuar para o pagamento/ });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText('Nome completo'), 'Marina Costa');
    await user.type(screen.getByLabelText('E-mail'), 'marina@acme.example');
    await user.type(screen.getByLabelText('WhatsApp'), '21987654321');
    await user.type(screen.getByLabelText('CNPJ'), '11222333000181');
    await user.click(screen.getByRole('radio', { name: 'Cartão' }));
    expect(screen.getByRole('radiogroup', { name: 'Tipo do cartão' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Cartão de crédito' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Cartão de débito' })).not.toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Cartão de crédito' }));
    expect(button).toBeDisabled();
    await user.click(screen.getByRole('checkbox',{name:/Li e aceito os termos/}));
    expect(button).toBeEnabled();
    await user.click(button);
    expect(onContinue).toHaveBeenCalledWith({
      plan: 'Start', cycle: 'monthly', addons: ['landing-page'],
      payment_method:'card',card_funding:'credit',
      customer_name: 'Marina Costa', customer_email: 'marina@acme.example', customer_phone: '+5521987654321', cnpj:'11222333000181',
    });
  });

  it('apresenta cartão como método único e reserva a bandeira para a digitação', async () => {
    const {container} = render(<CheckoutConfigurator onContinue={vi.fn()}/>);
    const methods = container.querySelectorAll('.checkout-payment-options label');
    expect(methods).toHaveLength(3);
    expect(methods[0]?.querySelectorAll('.checkout-payment-art img')).toHaveLength(0);
    expect(methods[0]?.querySelector('.checkout-payment-art svg')).not.toBeNull();
    expect(methods[1]?.querySelectorAll('.checkout-payment-art img')).toHaveLength(1);
    expect(methods[2]?.querySelectorAll('.checkout-payment-art img')).toHaveLength(1);
    const images = [...container.querySelectorAll<HTMLImageElement>('.checkout-payment-art img')];
    expect(images).toHaveLength(2);
    for(const image of images){
      expect(image.src).toMatch(/^data:image\/png;base64,/);
      expect(image.alt).toBe('');
    }
    expect(screen.queryByText('Seu pagamento via Pix')).not.toBeInTheDocument();
  });

  it('identifica a empresa pelo CNPJ e mantém documento ou WhatsApp inválidos bloqueando o avanço', async () => {
    const user=userEvent.setup();
    const onDraft=vi.fn().mockResolvedValue({cnpj_status:'found',company:{legal_name:'Acme Comércio Ltda.',trade_name:'Acme',status:'ATIVA'}});
    render(<CheckoutConfigurator onContinue={vi.fn()} onDraft={onDraft}/>);
    expect(screen.queryByLabelText('Empresa')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('CNPJ'),'11222333000181');
    expect(await screen.findByText('Empresa identificada: Acme')).toBeInTheDocument();
    expect(onDraft).toHaveBeenCalledWith(expect.objectContaining({cnpj:'11222333000181'}));
    await user.clear(screen.getByLabelText('CNPJ'));
    await user.type(screen.getByLabelText('CNPJ'),'11222333000180');
    expect(screen.getByText('Digite um CNPJ válido para continuar.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('WhatsApp'),'11911111111');
    expect(screen.getByText('Digite um WhatsApp válido com DDD.')).toBeInTheDocument();
    expect(screen.getByRole('button',{name:/Continuar para o pagamento/})).toBeDisabled();
  });

  it('só revela crédito ou débito depois que cartão é escolhido', async () => {
    const user = userEvent.setup();
    render(<CheckoutConfigurator onContinue={vi.fn()}/>);

    expect(screen.getByRole('radio', { name: 'Cartão' })).not.toBeChecked();
    expect(screen.queryByRole('radiogroup', { name: 'Tipo do cartão' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Cartão' }));
    const funding=screen.getByRole('radiogroup', { name: 'Tipo do cartão' });
    expect(funding).toBeInTheDocument();
    expect(funding).toHaveClass('checkout-card-funding-compact');
    expect(funding.querySelectorAll('small')).toHaveLength(0);
    expect(screen.getByRole('radio', { name: 'Cartão de crédito' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Cartão de débito' })).not.toBeChecked();
    expect(screen.getByText('Escolha crédito ou débito para continuar.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Pix/ }));
    expect(screen.queryByRole('radiogroup', { name: 'Tipo do cartão' })).not.toBeInTheDocument();
  });

  it('antecipa os valores futuros ao aceite no fluxo mobile e distingue o Pix avulso', async () => {
    const user = userEvent.setup();
    const {container} = render(<CheckoutConfigurator onContinue={vi.fn()}/>);
    await user.click(screen.getByRole('checkbox', { name: /Gestão de tráfego pago/i }));
    await user.click(screen.getByRole('radio', { name: /Pix/ }));
    const terms = container.querySelector('.checkout-mobile-terms');
    const consent = container.querySelector('.checkout-consent');
    expect(terms).toHaveTextContent('Cada período futuro exige um novo Pix.');
    expect(terms).toHaveTextContent('R$');
    expect(terms).toHaveTextContent('Gestão de tráfego');
    expect(terms?.compareDocumentPosition(consent!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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
    expect(screen.getAllByRole('radio')).toHaveLength(3);
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
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('region',{name:'Plano e periodicidade selecionados'})).toHaveTextContent('ORYNEO Growth');
    expect(screen.queryByRole('link',{name:'página de planos'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox',{name:/Landing page de conversão/i}));
    await user.type(screen.getByLabelText('Nome completo'),'Marina Costa');
    await user.type(screen.getByLabelText('E-mail'),'marina@acme.example');
    await user.type(screen.getByLabelText('WhatsApp'),'21987654321');
    await user.type(screen.getByLabelText('CNPJ'),'11222333000181');
    await user.click(screen.getByRole('radio',{name:'Cartão'}));
    await user.click(screen.getByRole('radio',{name:'Cartão de crédito'}));
    await user.click(screen.getByRole('checkbox',{name:/Li e aceito os termos/}));
    await user.click(screen.getByRole('button',{name:/Continuar para o pagamento/}));
    expect(onContinue).toHaveBeenCalledWith({
      plan:'Growth',cycle:'annual',addons:['landing-page'],
      payment_method:'card',card_funding:'credit',
      customer_name:'Marina Costa',customer_email:'marina@acme.example',customer_phone:'+5521987654321',cnpj:'11222333000181',
    });
  });

  it('applies the selected debit option before preparing checkout',async()=>{
    window.history.replaceState({}, '', '/contratar/?plan=Growth&cycle=monthly');
    const onContinue=vi.fn(),user=userEvent.setup();
    render(<CheckoutConfigurator onContinue={onContinue}/>);
    expect(screen.getByRole('radio',{name:'Cartão'})).not.toBeChecked();
    await user.click(screen.getByRole('radio',{name:'Cartão'}));
    await user.click(screen.getByRole('radio',{name:'Cartão de débito'}));
    await user.type(screen.getByLabelText('Nome completo'),'Marina Costa');
    await user.type(screen.getByLabelText('E-mail'),'marina@acme.example');
    await user.type(screen.getByLabelText('WhatsApp'),'21987654321');
    await user.type(screen.getByLabelText('CNPJ'),'11222333000181');
    await user.click(screen.getByRole('checkbox',{name:/Li e aceito os termos/}));
    await user.click(screen.getByRole('button',{name:/Continuar para o pagamento/}));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({payment_method:'card',card_funding:'debit'}));
  });

  it('offers boleto recurring invoices with manual payment per period',async()=>{
    const onContinue=vi.fn(),user=userEvent.setup();
    render(<CheckoutConfigurator onContinue={onContinue}/>);
    await user.click(screen.getByRole('radio',{name:/Boleto bancário/}));
    expect(screen.getByText(/Pagamento manual por período/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Nome completo'),'Marina Costa');
    await user.type(screen.getByLabelText('E-mail'),'marina@acme.example');
    await user.type(screen.getByLabelText('WhatsApp'),'21987654321');
    await user.type(screen.getByLabelText('CNPJ'),'11222333000181');
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
    await user.type(screen.getByLabelText('E-mail'), 'marina@acme.example');
    await user.type(screen.getByLabelText('WhatsApp'), '21987654321');
    await user.type(screen.getByLabelText('CNPJ'), '11222333000181');
    await user.click(screen.getByRole('checkbox',{name:/Li e aceito os termos/}));
    await user.click(screen.getByRole('button', { name: /Continuar para o Pix/ }));
    expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ payment_method: 'pix', customer_phone:'+5521987654321', cnpj: '11222333000181' }));
  });
});
