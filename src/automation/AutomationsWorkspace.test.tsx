import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutomationsWorkspace } from './AutomationsWorkspace';

const userId = 'user-automation-ui-tests';
describe('Automações: interação visual isolada', () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom does not implement pointer capture; this mocks only that browser API.
    if (!HTMLElement.prototype.setPointerCapture) {
      HTMLElement.prototype.setPointerCapture = () => undefined;
    }
    if (!HTMLElement.prototype.releasePointerCapture) {
      HTMLElement.prototype.releasePointerCapture = () => undefined;
    }
  });

  it('abre as seis subáreas sem depender de Supabase nem alterar WhatsApp', async () => {
    const user = userEvent.setup();
    render(<AutomationsWorkspace userId={userId}/>);
    const navigation = screen.getByRole('navigation', { name: 'Áreas de automações' });
    expect(within(navigation).getAllByRole('button')).toHaveLength(6);
    await user.click(within(navigation).getByRole('button', { name: /Execuções e diagnóstico/ }));
    expect(screen.getByText(/A nova engine ainda não está habilitada/i)).toBeInTheDocument();
  });

  it('cria um grafo conectado, salva no navegador e reabre o rascunho', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button', { name: /Fluxos do pipeline/ }));
    await user.click(screen.getByRole('button', { name: /Novo fluxo/i }));
    expect(screen.getByRole('textbox', { name: 'Nome do fluxo' })).toHaveValue('Novo fluxo do pipeline');
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(localStorage.getItem('oryneo:automations:draft:' + userId)).toContain('opportunity.created');
    unmount();
    render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button', { name: /Fluxos do pipeline/ }));
    await user.click(screen.getByRole('button', { name: /Novo fluxo do pipeline/ }));
    expect(screen.getByRole('textbox', { name: 'Nome do fluxo' })).toHaveValue('Novo fluxo do pipeline');
  });

  it('simula sem enviar mensagens ou publicar versões', async () => {
    const user = userEvent.setup();
    render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button', { name: /Fluxos do SDR/ }));
    await user.click(screen.getByRole('button', { name: /Novo fluxo/i }));
    await user.click(screen.getByTitle('Simular sem efeitos externos'));
    expect(await screen.findByText(/Simulação — não enviado/i)).toBeInTheDocument();
    const publish = screen.getByTitle('Publicação disponível após engine homologada');
    expect(publish).toBeDisabled();
    expect(screen.getByText(/Editor de preparação · sem merge, deploy ou ativação de fluxos/)).toBeInTheDocument();
  });

  it('insere condição conectada pelo menu de botão direito do nó', async () => {
    const user=userEvent.setup();
    render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button', { name: /Fluxos do pipeline/ }));
    await user.click(screen.getByRole('button', { name: /Novo fluxo/i }));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Editar nó Gatilho inicial' }));
    await user.click(screen.getByRole('button', { name: 'Criar condição conectada' }));
    expect(screen.getByRole('button', { name: /Editar nó Condição/ })).toBeInTheDocument();
    expect(screen.getByText(/Alterações no rascunho/)).toBeInTheDocument();
    expect(screen.getByTitle('Publicação disponível após engine homologada')).toBeDisabled();
  });
  it('não salva texto inválido como configuração de nó', async () => {
    const user = userEvent.setup();
    render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button', { name: /Fluxos do pipeline/ }));
    await user.click(screen.getByRole('button', { name: /Novo fluxo/i }));
    await user.click(screen.getByRole('button', { name: /Editar nó Gatilho inicial/ }));
    const config = screen.getByRole('textbox', { name: 'Configuração JSON do nó' });
    await user.clear(config);
    await user.type(config, 'não é JSON');
    await user.click(screen.getByRole('button', { name: 'Aplicar configuração' }));
    await waitFor(() => expect(screen.getByText(/JSON inválido: o nó não foi alterado/)).toBeInTheDocument());
  });

  it('edita grupos E/OU no inspetor sem JSON nem publicação', async () => {
    const user=userEvent.setup();
    render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button', { name: /Fluxos do pipeline/ }));
    await user.click(screen.getByRole('button', { name: /Novo fluxo/i }));
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Editar nó Gatilho inicial' }));
    await user.click(screen.getByRole('button', { name: 'Criar condição conectada' }));
    await user.click(screen.getByRole('button', { name: 'Editar nó Condição' }));
    expect(screen.getByRole('combobox',{name:'Campo da condição root'})).toBeInTheDocument();
    expect(screen.queryByRole('textbox',{name:'Configuração JSON do nó'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:/Combinar com outra condição/}));
    fireEvent.change(screen.getByRole('combobox',{name:'Operador lógico root'}),{target:{value:'any'}});
    fireEvent.change(screen.getByRole('combobox',{name:'Campo da condição 1'}),{target:{value:'billing.paid_verified'}});
    await user.click(screen.getByRole('button',{name:'Salvar rascunho'}));
    const stored=localStorage.getItem('oryneo:automations:draft:'+userId)||'';
    expect(stored).toContain('"op":"any"');
    expect(stored).toContain('billing.paid_verified');
    expect(screen.getByTitle('Publicação disponível após engine homologada')).toBeDisabled();
  });


  it('cria um bloco no menu de contexto do canvas, sem conectá-lo silenciosamente', async () => {
    const user=userEvent.setup();
    const {container}=render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button',{name:/Fluxos do pipeline/}));
    await user.click(screen.getByRole('button',{name:/Novo fluxo/i}));
    const canvas=container.querySelector('.ory-auto-canvas-scroll');
    expect(canvas).not.toBeNull();
    fireEvent.contextMenu(canvas!,{clientX:180,clientY:220});
    await user.click(screen.getByRole('button',{name:'Adicionar: Condição'}));
    expect(screen.getByRole('button',{name:'Editar nó Condição'})).toBeInTheDocument();
    expect(screen.getByText(/Conecte as portas antes de validar/)).toBeInTheDocument();
    expect(screen.getByTitle('Publicação disponível após engine homologada')).toBeDisabled();
  });

});
