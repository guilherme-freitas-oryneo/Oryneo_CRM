import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TermsDialog } from './TermsDialog';

describe('visualizador jurídico de homologação', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('apresenta o contrato completo sem navegar e volta ao checkout', async () => {
    const mockFetch=vi.fn().mockResolvedValue({
      ok:true,
      text:async()=> 'TERMOS GERAIS DE CONTRATAÇÃO E USO DOS SERVIÇOS ORYNEO\n\n1. Objeto da contratação\n\nConteúdo do contrato.\n\nANEXO III — Política de uso aceitável'
    });
    vi.stubGlobal('fetch',mockFetch);
    const user=userEvent.setup();
    render(<TermsDialog />);
    await user.click(screen.getByRole('button',{name:'Consultar termos completos'}));
    expect(await screen.findByRole('heading',{name:'1. Objeto da contratação'})).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button',{name:'Voltar à contratação'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('se a íntegra falha, não simula leitura nem aceite', async () => {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false}));
    const user=userEvent.setup();
    render(<TermsDialog />);
    await user.click(screen.getByRole('button',{name:'Consultar termos completos'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});
