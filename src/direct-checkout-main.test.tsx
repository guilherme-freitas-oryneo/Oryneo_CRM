import { render, screen, waitFor } from '@testing-library/react';
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
    mocks.invoke.mockImplementation((_name:string,{body}:{body:{action?:string}})=>Promise.resolve(body.action==='draft'
      ? {data:{ok:true,cnpj_status:'found',company:{legal_name:'Acme Comércio',trade_name:'Acme',status:'ATIVA'}},error:null}
      : {data:{url:'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/pagar/?token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'},error:null}));
  });

  it('revela o pagamento seguro na mesma jornada depois de criar a sessão',async()=>{
    const user=userEvent.setup();
    render(<DirectCheckoutPage/>);
    await user.click(screen.getByRole('radio',{name:'Cartão'}));
    await user.click(screen.getByRole('radio',{name:'Cartão de crédito'}));
    await user.type(screen.getByLabelText('Nome completo'),'Marina Costa');
    await user.type(screen.getByLabelText('E-mail'),'marina@acme.example');
    await user.type(screen.getByLabelText('WhatsApp'),'21987654321');
    await user.type(screen.getByLabelText('CNPJ'),'11222333000181');
    await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith('checkout-intake',{body:expect.objectContaining({action:'draft',customer_name:'Marina Costa'})}),{timeout:2000});
    await user.click(screen.getByRole('checkbox',{name:/Li e aceito os termos/}));
    await user.click(screen.getByRole('button',{name:/Continuar para o pagamento/}));

    const draftCall=mocks.invoke.mock.calls.find(([,options])=>options.body.action==='draft');
    const checkoutCall=mocks.invoke.mock.calls.find(([,options])=>options.body.action==='checkout');
    expect(checkoutCall?.[1].body.request_id).toBe(draftCall?.[1].body.request_id);
    expect(checkoutCall?.[1].body.payment_token).toBe(draftCall?.[1].body.payment_token);
    expect(await screen.findByText('Pagamento incorporado')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/Oryneo_CRM/pagar/');
    expect(window.location.search).toBe('?token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  });
});
