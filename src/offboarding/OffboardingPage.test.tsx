import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect,vi} from 'vitest';
import {OffboardingView} from './OffboardingPage';
const order={reference:'ORY-TEST-0001',company:'Empresa QA',customer_name:'Marina'};
describe('F05 autoatendimento',()=>{
 it('encaminha à autenticação hospedada na Stripe, não a cancelamento por token',()=>{
  render(<OffboardingView order={order} onRequest={vi.fn()}/>);
  const link=screen.getByRole('link',{name:/Abrir portal seguro de assinatura/});
  expect(link.getAttribute('href')).toMatch(/^https:\/\/billing\.stripe\.com\/p\/login\/test_/);
  expect(link).toHaveAttribute('rel','noopener noreferrer');
  expect(screen.getByText(/não gera arquivo automaticamente/i)).toBeInTheDocument();
 });
 it('requer identidade preenchida antes de registrar pedido',async()=>{
  const user=userEvent.setup(),onRequest=vi.fn();
  render(<OffboardingView order={order} onRequest={onRequest}/>);
  const button=screen.getByRole('button',{name:'Registrar solicitação'});
  expect(button).toBeDisabled();
  await user.type(screen.getByLabelText('Nome completo'),'Marina Costa');
  await user.type(screen.getByLabelText('E-mail vinculado à contratação'),'marina@example.com');
  expect(button).toBeEnabled();
  await user.click(button);
  expect(onRequest).toHaveBeenCalledWith({type:'data_export',name:'Marina Costa',email:'marina@example.com',details:''});
 });
 it('não promete arquivo enviado quando a solicitação é registrada',()=>{
  render(<OffboardingView order={order} onRequest={vi.fn()} done/>);
  expect(screen.getByText(/Solicitação registrada para análise/)).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Registrar solicitação'})).not.toBeInTheDocument();
 });
});
