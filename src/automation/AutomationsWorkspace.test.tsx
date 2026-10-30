import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutomationsWorkspace } from './AutomationsWorkspace';

const userId = 'user-automation-ui-tests';
describe('Automações: interação visual isolada', () => {
  beforeEach(() => localStorage.clear());

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
});
