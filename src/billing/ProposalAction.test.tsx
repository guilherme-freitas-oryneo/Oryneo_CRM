import {render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {ProposalAction} from './ProposalAction';

const mocks=vi.hoisted(()=>({latest:vi.fn(),invoke:vi.fn()}));
vi.mock('../data',()=>({
  supabase:{
    functions:{invoke:mocks.invoke},
    from:()=>({select:()=>({eq:()=>({order:()=>({limit:()=>({maybeSingle:mocks.latest})})})})})
  },
  errorText:(error:unknown)=>error instanceof Error?error.message:'Erro inesperado',
}));

const token='A'.repeat(43);
const proposalUrl='https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/proposta/?token='+token;

describe('acesso aos links individuais de proposta',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mocks.latest.mockResolvedValue({data:{status:'sent',version:1,expires_at:'2027-01-01T00:00:00Z'},error:null});
  mocks.invoke.mockResolvedValue({data:{ok:true,version:1,url:proposalUrl,email_sent:true},error:null});
 });
 it('oferece Abrir proposta em nova aba e preserva a versão na sessão',async()=>{
  const user=userEvent.setup();
  const props={dealId:'deal-A',canPrepare:true,onPrepareBilling:vi.fn().mockResolvedValue({reference:'ORY-1',url:'https://example.test/'})};
  const view=render(<ProposalAction {...props}/>);
  await screen.findByText(/aguardando aceite do cliente/i);
  await user.click(screen.getByRole('button',{name:'Emitir nova versão'}));
  const link=await screen.findByRole('link',{name:'Abrir proposta em nova aba'});
  expect(link).toHaveAttribute('href',proposalUrl);
  expect(link).toHaveAttribute('target','_blank');
  expect(link).toHaveAttribute('rel','noopener noreferrer');
  expect(screen.getByRole('textbox',{name:'Link seguro da proposta'})).toHaveValue(proposalUrl);
  expect(screen.getByRole('status')).toHaveTextContent('Proposta enviada por e-mail');
  view.unmount();
  render(<ProposalAction {...props}/>);
  await waitFor(()=>expect(screen.getByRole('link',{name:'Abrir proposta em nova aba'})).toHaveAttribute('href',proposalUrl));
 });
 it('invalida link armazenado quando outra versão substitui a proposta',async()=>{
  const user=userEvent.setup();
  const props={dealId:'deal-B',canPrepare:true,onPrepareBilling:vi.fn().mockResolvedValue({reference:'ORY-2',url:'https://example.test/'})};
  const view=render(<ProposalAction {...props}/>);
  await screen.findByText(/aguardando aceite do cliente/i);
  await user.click(screen.getByRole('button',{name:'Emitir nova versão'}));
  await screen.findByRole('link',{name:'Abrir proposta em nova aba'});
  view.unmount();
  mocks.latest.mockResolvedValue({data:{status:'sent',version:2,expires_at:'2027-01-02T00:00:00Z'},error:null});
  render(<ProposalAction {...props}/>);
  await screen.findByText(/Versão 2 aguardando aceite do cliente/);
  await waitFor(()=>expect(screen.queryByRole('link',{name:'Abrir proposta em nova aba'})).not.toBeInTheDocument());
 });
 it('avisa quando a proposta foi criada mas o e-mail precisa de revisão',async()=>{
  const user=userEvent.setup();
  mocks.invoke.mockResolvedValue({data:{ok:true,version:1,url:proposalUrl,email_sent:false},error:null});
  render(<ProposalAction dealId="deal-C" canPrepare onPrepareBilling={vi.fn()}/>);
  await screen.findByText(/aguardando aceite do cliente/i);
  await user.click(screen.getByRole('button',{name:'Emitir nova versão'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('proposta foi criada, mas o envio por e-mail precisa de revisão');
  expect(screen.getByRole('textbox',{name:'Link seguro da proposta'})).toHaveValue(proposalUrl);
 });
});
