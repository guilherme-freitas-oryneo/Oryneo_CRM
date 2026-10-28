import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,afterEach,describe,expect,it,vi} from 'vitest';
import {ProposalPage} from './ProposalPage';

const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('../data',()=>({supabase:{functions:{invoke:mocks.invoke}}}));

const token='Q'.repeat(43);
const proposal={
 version:4,status:'sent',company:'Empresa de Homologação',customer_name:'Cliente Autorizado',
 contact_email:'qa@example.invalid',expires_at:'2027-01-01T12:00:00Z',accepted_at:null,
 snapshot_sha256:'c'.repeat(64),
 snapshot:{
  schema:'oryneo.proposal.v1',catalog_version:'2026-10-13',plan:'Start',cycle:'monthly',addons:[],
  items:[{key:'start',label:'Plano Start',detail:'Mensal',amount_cents:74990,recurring:true}],
  amount_total:173980,recurring:{label:'Plano Start',amount_cents:74990,interval_label:'por mês'},
  traffic_renewal_amount_cents:null,media_budget_included:false,notice:'Condições de homologação',
 }
};

describe('jornada pública da proposta — sem SMTP ou pagamentos reais',()=>{
 beforeEach(()=>{
  mocks.invoke.mockReset();
  window.history.replaceState({},'', '/proposta/?token='+token);
  mocks.invoke.mockImplementation((_name:string,{body}:{body:{action:string}})=>{
   if(body.action==='read')return Promise.resolve({data:{ok:true,proposal},error:null});
   if(body.action==='accept')return Promise.resolve({data:{ok:true,accepted:true,version:4},error:null});
   throw Error('Ação inesperada na simulação');
  });
 });
 afterEach(()=>window.history.replaceState({},'', '/'));
 it('consulta por token e só aceita com identidade, termos e hash do snapshot',async()=>{
  const user=userEvent.setup();
  render(<ProposalPage/>);
  await screen.findByRole('button',{name:'Aceitar esta versão'});
  expect(mocks.invoke).toHaveBeenCalledWith('proposal-public',{body:{action:'read',token}});
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  const action=screen.getByRole('button',{name:'Aceitar esta versão'});
  expect(action).toBeDisabled();
  await user.type(screen.getByLabelText('Nome completo'),'Cliente Autorizado');
  await user.type(screen.getByLabelText('E-mail destinatário da proposta'),'qa@example.invalid');
  expect(action).toBeDisabled();
  await user.click(screen.getByRole('checkbox'));
  await user.click(action);
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith('proposal-public',{body:{
   action:'accept',token,name:'Cliente Autorizado',email:'qa@example.invalid',
   snapshot_sha256:'c'.repeat(64),consent:true
  }}));
  expect(await screen.findByRole('heading',{name:'Aceite registrado.'})).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Aceitar esta versão'})).not.toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
 });
 it('não registra aceite se a página pública recusar a operação',async()=>{
  const user=userEvent.setup();
  mocks.invoke.mockImplementation((_name:string,{body}:{body:{action:string}})=>Promise.resolve(body.action==='read'
   ?{data:{ok:true,proposal},error:null}:{data:{ok:false,error:'Aceite expirado.'},error:null}));
  render(<ProposalPage/>);
  await screen.findByRole('button',{name:'Aceitar esta versão'});
  await user.type(screen.getByLabelText('Nome completo'),'Cliente Autorizado');
  await user.type(screen.getByLabelText('E-mail destinatário da proposta'),'qa@example.invalid');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button',{name:'Aceitar esta versão'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Aceite expirado.');
  expect(screen.queryByRole('heading',{name:'Aceite registrado.'})).not.toBeInTheDocument();
 });
});
