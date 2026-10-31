import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TypedNodeConfigEditor } from './TypedNodeConfigEditor';
import type { FlowNode, NodeKind } from './flowDefinition';
import type { NodeReferenceCatalog } from './api';

const catalog:NodeReferenceCatalog={
  stages:[{id:'stage-1',name:'Diagnóstico pendente'}],
  templates:[{id:'approved-verified',name:'oryneo_welcome_v3'}],
  knowledge:[],
  dictionaries:[],
};
const node=(type:NodeKind,config:Record<string,unknown>):FlowNode=>({
  id:'some-node',type,label:type,position:{x:0,y:0},config,ports:['in','out'],
});
describe('Automações: inspetor tipado sem efeitos',()=>{
  it('só oferece templates do catálogo homologado vindo do servidor',()=>{
    const onChange=vi.fn();
    render(<TypedNodeConfigEditor
      node={node('whatsapp_template',{template_registry_id:'',locale:'pt_BR'})}
      catalog={catalog} onChange={onChange}/>);
    const select=screen.getByRole('combobox',{name:/Template aprovado/});
    expect(screen.getByRole('option',{name:'oryneo_welcome_v3'})).toBeInTheDocument();
    expect(screen.queryByRole('option',{name:'template-rascunho'})).not.toBeInTheDocument();
    fireEvent.change(select,{target:{value:'approved-verified'}});
    expect(onChange).toHaveBeenCalledWith({
      template_registry_id:'approved-verified',locale:'pt_BR',
    });
  });
  it('um template não cadastrado permanece visível como não homologado, nunca como aprovado',()=>{
    const onChange=vi.fn();
    render(<TypedNodeConfigEditor
      node={node('whatsapp_template',{template_registry_id:'old-id',locale:'pt_BR'})}
      catalog={catalog} onChange={onChange}/>);
    expect(screen.getByRole('option',{name:'Referência não homologada'})).toHaveValue('old-id');
    expect(onChange).not.toHaveBeenCalled();
  });
  it('não oferece escrita financeira em um nó de consulta',()=>{
    const onChange=vi.fn();
    render(<TypedNodeConfigEditor node={node('billing_read',{})} catalog={catalog} onChange={onChange}/>);
    expect(screen.getByText(/Somente leitura do estado financeiro canônico/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('bloqueia valores de tempo fora do intervalo homologável',()=>{
    const onChange=vi.fn();
    render(<TypedNodeConfigEditor node={node('wait',{
      duration_minutes:60,cancel_on_reply:true,
    })} catalog={catalog} onChange={onChange}/>);
    fireEvent.change(screen.getByRole('spinbutton',{name:'Tempo de espera (minutos)'}),{
      target:{value:'43201'},
    });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('spinbutton',{name:'Tempo de espera (minutos)'}),{
      target:{value:'120'},
    });
    expect(onChange).toHaveBeenCalledWith({duration_minutes:120,cancel_on_reply:true});
  });
  it('cria parâmetros de CRM só com referências canônicas de etapa',()=>{
    const onChange=vi.fn();
    render(<TypedNodeConfigEditor node={node('crm_stage_change',{target_stage_id:''})}
      catalog={catalog} onChange={onChange}/>);
    fireEvent.change(screen.getByRole('combobox',{name:'Etapa comercial de destino'}),{
      target:{value:'stage-1'},
    });
    expect(onChange).toHaveBeenCalledWith({target_stage_id:'stage-1'});
  });
  it('permite escolher somente eventos canônicos cadastrados',()=>{
    const onChange=vi.fn();
    render(<TypedNodeConfigEditor node={node('trigger',{event_type:'opportunity.created'})}
      catalog={catalog} onChange={onChange}/>);
    const control=screen.getByRole('combobox',{name:'Evento canônico'});
    expect(screen.getByRole('option',{name:'billing.paid_verified'})).toBeInTheDocument();
    expect(screen.getByRole('option',{name:'mail.sent'})).toBeInTheDocument();
    expect(screen.getByRole('option',{name:'onboarding.started'})).toBeInTheDocument();
    expect(screen.queryByRole('option',{name:'stripe.charge_anything'})).not.toBeInTheDocument();
    fireEvent.change(control,{target:{value:'conversation.inbound'}});
    expect(onChange).toHaveBeenCalledWith({event_type:'conversation.inbound'});
  });
});
