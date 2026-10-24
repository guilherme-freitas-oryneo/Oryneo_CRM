import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe,it,expect,vi} from 'vitest';
import {ProposalView,type PublicProposal} from './ProposalPage';

const sample:PublicProposal={
 version:1,status:'sent',company:'Empresa Exemplo',customer_name:'Marina Costa',
 contact_email:'marina@example.com',expires_at:'2026-12-01T19:00:00Z',accepted_at:null,
 snapshot_sha256:'a'.repeat(64),
 snapshot:{schema:'oryneo.proposal.v1',catalog_version:'2026-10-13',plan:'Growth',cycle:'monthly',
  addons:['traffic'],items:[
   {key:'growth_monthly',label:'Plano Growth',detail:'Mensal',amount_cents:109990,recurring:true},
   {key:'traffic',label:'Gestão de tráfego',detail:'Trimestre',amount_cents:296970,recurring:false}
  ],amount_total:406960,
  recurring:{label:'Plano Growth',amount_cents:109990,interval_label:'por mês'},
  traffic_renewal_amount_cents:296970,
  traffic_renewal_interval:'a cada três meses, após os primeiros três meses',
  media_budget_included:false,notice:'Aceite comercial individual.',
  presentation:{schema:'oryneo.proposal-presentation.v1',primary_goal:'Organizar contatos e negociações no CRM',items:[
   {key:'platform',eyebrow:'PLATAFORMA CRM',title:'Plano Growth',summary:'Estrutura para apoiar a prioridade informada.',bullets:['Pipeline comercial para organizar oportunidades por etapa.','Até 10 usuários no plano contratado.'],commercial_detail:'Assinatura mensal · até 10 usuários'},
   {key:'implementation',eyebrow:'COLOCAÇÃO EM OPERAÇÃO',title:'Implantação',summary:'Preparação inicial do ambiente.',bullets:['Configuração inicial do ambiente e do funil comercial.'],commercial_detail:'Cobrança única'},
   {key:'traffic',eyebrow:'GESTÃO CONTÍNUA',title:'Gestão de tráfego pago',summary:'Ciclo inicial contratado por três meses.',bullets:['A verba de mídia é paga separadamente e não integra este valor.'],commercial_detail:'Primeiros 3 meses antecipados · renovação a cada 3 meses'}
  ],journey:[
   {key:'acceptance',title:'Aceite desta versão',description:'Confirmação dos itens apresentados.'},
   {key:'payment',title:'Preparação do pagamento',description:'Link liberado após o aceite.'},
   {key:'implementation',title:'Início da implantação',description:'Preparação após confirmação.'}
  ]}
 }
};
describe('F01 proposta comercial',()=>{
 it('materializa prioridade, entregas contratadas e jornada de entrada em operação',()=>{
  render(<ProposalView proposal={sample} onAccept={vi.fn()}/>);
  expect(screen.getByText('Organizar contatos e negociações no CRM')).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'O que está incluído'})).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Plano Growth'})).toBeInTheDocument();
  expect(screen.getByText('Até 10 usuários no plano contratado.')).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Implantação'})).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Gestão de tráfego pago'})).toBeInTheDocument();
  expect(screen.queryByRole('heading',{name:'Landing page de conversão'})).not.toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Como a contratação ganha forma'})).toBeInTheDocument();
 });

 it('permite imprimir ou salvar a proposta como PDF',async()=>{
  const print=vi.spyOn(window,'print').mockImplementation(()=>{});
  render(<ProposalView proposal={sample} onAccept={vi.fn()}/>);
  await userEvent.click(screen.getByRole('button',{name:'Imprimir ou salvar em PDF'}));
  expect(print).toHaveBeenCalledOnce();
  print.mockRestore();
 });

 it('mantém propostas anteriores legíveis quando o snapshot não possui apresentação',()=>{
  render(<ProposalView proposal={{...sample,snapshot:{...sample.snapshot,presentation:undefined}}} onAccept={vi.fn()}/>);
  expect(screen.getByText('R$ 4.069,60')).toBeInTheDocument();
  expect(screen.queryByRole('heading',{name:'O que está incluído'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Aceitar esta versão'})).toBeInTheDocument();
 });

 it('mostra valor inicial, recorrência e não cobra na página de aceite',()=>{
  render(<ProposalView proposal={sample} onAccept={vi.fn()}/>);
  expect(screen.getByText('R$ 4.069,60')).toBeInTheDocument();
  expect(screen.getByText(/R\$ 1\.099,90 por mês/)).toBeInTheDocument();
  expect(screen.getByText(/verba de mídia é cobrada separadamente/i)).toBeInTheDocument();
  expect(screen.getByText(/nenhum valor é cobrado nesta página/i)).toBeInTheDocument();
 });
 it('exige identidade e consentimento para registrar aceite',async()=>{
  const onAccept=vi.fn();const user=userEvent.setup();
  render(<ProposalView proposal={sample} onAccept={onAccept}/>);
  const button=screen.getByRole('button',{name:'Aceitar esta versão'});
  expect(button).toBeDisabled();
  await user.type(screen.getByLabelText('Nome completo'),'Marina Costa');
  await user.type(screen.getByLabelText('E-mail destinatário da proposta'),'marina@example.com');
  expect(button).toBeDisabled();
  await user.click(screen.getByRole('checkbox'));
  expect(button).toBeEnabled();
  await user.click(button);
  expect(onAccept).toHaveBeenCalledWith({name:'Marina Costa',email:'marina@example.com'});
 });
 it('não oferece aceite de proposta substituída ou expirada',()=>{
  render(<ProposalView proposal={{...sample,status:'superseded'}} onAccept={vi.fn()}/>);
  expect(screen.queryByRole('button',{name:'Aceitar esta versão'})).not.toBeInTheDocument();
  expect(screen.getByText(/proposta não está disponível/i)).toBeInTheDocument();
 });
 it('não solicita novo aceite após confirmação',()=>{
  render(<ProposalView proposal={{...sample,status:'accepted',accepted_at:'2026-10-16T12:00:00Z'}} onAccept={vi.fn()}/>);
  expect(screen.getByText('Aceite registrado.')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Aceitar esta versão'})).not.toBeInTheDocument();
 });
});
