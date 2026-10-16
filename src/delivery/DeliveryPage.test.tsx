import {render,screen} from '@testing-library/react';
import {describe,it,expect} from 'vitest';
import {DeliveryView,type DeliveryRecord} from './DeliveryPage';

const payload:DeliveryRecord={
 order:{reference:'ORY-TEST-0001',company:'Acme Exemplo',customer_name:'Marina',plan:'Growth'},
 project:{status:'in_progress',started_at:'2026-10-16T12:00:00Z',
  completed_at:null,created_at:'2026-10-16T12:00:00Z',updated_at:'2026-10-16T12:00:00Z'},
 milestones:[
  {id:'1',position:1,title:'Kickoff',state:'completed',due_at:null,note:'Reunião feita',
   completed_at:'2026-10-16T12:00:00Z',updated_at:'2026-10-16T12:00:00Z'},
  {id:'2',position:2,title:'Preparação',state:'in_progress',due_at:null,note:null,
   completed_at:null,updated_at:'2026-10-16T12:00:00Z'}
 ]
};
describe('F03 portal de implantação',()=>{
 it('exibe apenas marcos concluídos e progresso realmente registrado',()=>{
  render(<DeliveryView record={payload}/>);
  expect(screen.getByText(/Acme Exemplo, acompanhe/i)).toBeInTheDocument();
  expect(screen.getByText(/Implantação em andamento/i)).toBeInTheDocument();
  expect(screen.getByText('01 · Kickoff')).toBeInTheDocument();
  expect(screen.getByText('02 · Preparação')).toBeInTheDocument();
  expect(screen.queryByText(/Previsão registrada/)).not.toBeInTheDocument();
 });
 it('não declara implantação concluída sem o estado de conclusão',()=>{
  render(<DeliveryView record={payload}/>);
  expect(screen.queryByText(/A equipe registrou a conclusão em/)).not.toBeInTheDocument();
 });
 it('exibe marco futuro só quando a equipe cadastra a previsão',()=>{
  render(<DeliveryView record={{...payload,milestones:payload.milestones.map(step=>
    step.id==='2'?{...step,due_at:'2026-12-01T12:00:00Z'}:step)}}/>);
  expect(screen.getByText(/Previsão registrada/)).toBeInTheDocument();
 });
});
