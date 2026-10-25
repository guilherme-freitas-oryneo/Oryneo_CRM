import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({invoke:vi.fn(),rootRender:vi.fn()}));

vi.mock('./data',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
vi.mock('./billing/PaymentPage',()=>({PaymentPage:()=> <div>Pagamento incorporado</div>}));
vi.mock('react-dom/client',()=>({default:{createRoot:()=>({render:mocks.rootRender})}}));

import { DirectCheckoutPage } from './direct-checkout-main';

describe('DirectCheckoutPage',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.replaceState({},'','/Oryneo_CRM/contratar/?plan=Start&cycle=monthly');
    mocks.invoke.mockResolvedValue({data:{url:'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/pagar/?token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'},error:null});
  });

  it('revela o pagamento seguro na mesma jornada depois de criar a sessão',async()=>{
    const user=userEvent.setup();
    render(<DirectCheckoutPage/>);
    await user.click(screen.getByRole('radio',{name:'Cartão'}));
    await user.click(screen.getByRole('radio',{name:'Cartão de crédito'}));
    await user.type(screen.getByLabelText('Nome completo'),'Marina Costa');
    await user.type(screen.getByLabelText('E-mail corporativo'),'marina@acme.example');
    await user.type(screen.getByLabelText('Empresa'),'Acme Comércio');
    await user.type(screen.getByLabelText('CPF ou CNPJ'),'52998224725');
    await user.click(screen.getByRole('checkbox',{name:/Li e aceito os termos/}));
    await user.click(screen.getByRole('button',{name:/Continuar para o pagamento/}));

    expect(await screen.findByText('Pagamento incorporado')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/Oryneo_CRM/pagar/');
    expect(window.location.search).toBe('?token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  });
});
