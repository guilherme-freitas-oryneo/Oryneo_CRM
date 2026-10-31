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

  it('separa os canvases Pipeline e SDR e permite clicar na biblioteca sem exigir uma aresta',async()=>{
    const user=userEvent.setup();
    render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button',{name:/Fluxos do SDR/}));
    await user.click(screen.getByRole('button',{name:/Novo fluxo/i}));
    const trigger=screen.getByRole('button',{name:'Editar nó Gatilho inicial'});
    expect(trigger).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Adicionar bloco Classificação de intenção'}));
    expect(screen.getByRole('button',{name:'Editar nó Classificação de intenção'})).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Adicionar bloco Mover etapa comercial'})).not.toBeInTheDocument();
    expect(screen.getByTitle('Publicação disponível após engine homologada')).toBeDisabled();
  });

  it('oferece controles acessíveis para colapsar biblioteca/inspetor e localizar nós',async()=>{
    const user=userEvent.setup();
    render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button',{name:/Fluxos do pipeline/}));
    await user.click(screen.getByRole('button',{name:/Novo fluxo/i}));
    const palette=screen.getByTitle('Alternar biblioteca de nós');
    const inspector=screen.getByTitle('Alternar inspetor');
    expect(palette).toHaveAttribute('aria-pressed','true');
    await user.click(palette);
    expect(palette).toHaveAttribute('aria-pressed','false');
    expect(screen.queryByPlaceholderText('Buscar bloco')).not.toBeInTheDocument();
    await user.click(palette);
    expect(screen.getByPlaceholderText('Buscar bloco')).toBeInTheDocument();
    await user.click(inspector);
    expect(inspector).toHaveAttribute('aria-pressed','false');
    await user.click(inspector);
    expect(inspector).toHaveAttribute('aria-pressed','true');
    const search=screen.getByRole('searchbox',{name:'Procurar nó no fluxo'});
    await user.type(search,'Gatilho');
    await user.click(screen.getByTitle('Centralizar nó pesquisado'));
    expect(screen.getByRole('button',{name:'Editar nó Gatilho inicial'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByTitle('Publicação disponível após engine homologada')).toBeDisabled();
  });

  it('duplica bloco por menu touch, oferece edição de rótulo da aresta e preserva rascunho',async()=>{
    const user=userEvent.setup();
    render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button',{name:/Fluxos do pipeline/}));
    await user.click(screen.getByRole('button',{name:/Novo fluxo/i}));
    await user.click(screen.getByRole('button',{name:'Adicionar bloco Condição'}));
    await user.click(screen.getByRole('button',{name:'Menu do nó Condição'}));
    await user.click(screen.getByRole('button',{name:'Duplicar nó'}));
    expect(screen.getByRole('button',{name:'Editar nó Condição — cópia'})).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Salvar rascunho'}));
    expect(localStorage.getItem('oryneo:automations:draft:'+userId)).toContain('Condição — cópia');
  });

  it('conecta portas de nós por clique mantendo modo visual e sem efeitos externos',async()=>{
    const user=userEvent.setup();
    render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button',{name:/Fluxos do SDR/}));
    await user.click(screen.getByRole('button',{name:/Novo fluxo/i}));
    await user.click(screen.getByRole('button',{name:'Adicionar bloco Esperar evento ou prazo'}));
    await user.click(screen.getByRole('button',{name:'Conectar saída out do nó Esperar evento ou prazo'}));
    await user.click(screen.getByRole('button',{name:'Editar nó Fim'}));
    expect(screen.getByText(/operação não foi aplicada|Conecte as portas|Alterações no rascunho/)).toBeInTheDocument();
    expect(screen.getByTitle('Publicação disponível após engine homologada')).toBeDisabled();
  });

  it('deleta aresta por menu sem apagar nós, desfaz e refaz com histórico',async()=>{
    const user=userEvent.setup();
    const {container}=render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button',{name:/Fluxos do pipeline/}));
    await user.click(screen.getByRole('button',{name:/Novo fluxo/i}));
    const edge=container.querySelector('.ory-auto-edge-add');
    expect(edge).not.toBeNull();
    fireEvent.contextMenu(edge!,{clientX:200,clientY:170});
    await user.click(screen.getByRole('button',{name:'Remover conexão'}));
    expect(container.querySelectorAll('.ory-auto-edge-add')).toHaveLength(0);
    expect(container.querySelectorAll('.ory-auto-node')).toHaveLength(2);
    await user.click(screen.getByTitle('Desfazer'));
    expect(container.querySelectorAll('.ory-auto-edge-add')).toHaveLength(1);
    await user.click(screen.getByTitle('Refazer'));
    expect(container.querySelectorAll('.ory-auto-edge-add')).toHaveLength(0);
  });

  it('exibe propriedade dos canais somente em leitura e sem ação de cutover',async()=>{
    const user=userEvent.setup();
    render(<AutomationsWorkspace userId={userId}/>);
    await user.click(screen.getByRole('button',{name:/Templates e canais/}));
    expect(screen.getByRole('region',{name:'Proprietários das integrações comerciais'})).toBeInTheDocument();
    expect(screen.getByText(/Nenhum disparo está autorizado por esta tela/)).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:/Ativar canal|Transferir execução|Enviar agora/})).not.toBeInTheDocument();
  });

});
