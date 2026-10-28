import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybookLibrary } from './PlaybookLibrary';
import { CONTENT_VERSION, slides } from './content';
import { loadPlaybookState, saveAnnotation, saveProgress } from './api';

vi.mock('./api',async(importOriginal)=>{
  const actual=await importOriginal<typeof import('./api')>();
  return {...actual,loadPlaybookState:vi.fn(),saveProgress:vi.fn(),saveAnnotation:vi.fn(),
    editAnnotation:vi.fn(),removeAnnotation:vi.fn()};
});

const userId='22222222-2222-4222-8222-222222222222';

describe('PlaybookLibrary',()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    vi.mocked(loadPlaybookState).mockResolvedValue({userId,annotations:[],lastSlide:'02'});
    vi.mocked(saveProgress).mockResolvedValue(undefined);
    vi.mocked(saveAnnotation).mockImplementation(async (_, selection, note, visibility,color)=>({
      ...selection,
      id:'11111111-1111-4111-8111-111111111111',user_id:userId,note,visibility,color,
      content_version:CONTENT_VERSION,created_at:'2026-10-28T00:00:00Z',updated_at:'2026-10-28T00:00:00Z'
    }));
  });
  it('inicia na capa de espera e permite apresentação manual por slides',async()=>{
    const user=userEvent.setup();
    render(<PlaybookLibrary/>);
    expect(screen.getByRole('heading',{name:/Playbook\s*Comercial/i})).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Iniciar apresentação'}));
    expect(screen.getByRole('heading',{name:slides[0].title})).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Próximo slide'}));
    expect(screen.getByRole('heading',{name:slides[1].title})).toBeInTheDocument();
    await waitFor(()=>expect(saveProgress).toHaveBeenCalledWith(userId,'02'));
  });
  it('retoma o progresso e disponibiliza o índice',async()=>{
    const user=userEvent.setup();
    render(<PlaybookLibrary/>);
    await user.click(await screen.findByRole('button',{name:/Retomar no slide 02/i}));
    expect(screen.getByRole('heading',{name:slides[1].title})).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Mostrar índice'}));
    expect(within(screen.getByLabelText('Índice do playbook')).getAllByRole('button').length).toBe(64);
  });
  it('atualiza a retomada ao voltar à capa na mesma sessão',async()=>{
    const user=userEvent.setup();
    render(<PlaybookLibrary/>);
    await user.click(screen.getByRole('button',{name:'Iniciar apresentação'}));
    await user.click(screen.getByRole('button',{name:'Próximo slide'}));
    await user.click(screen.getByRole('button',{name:'Voltar ao início'}));
    expect(await screen.findByRole('button',{name:/Retomar no slide 02/})).toBeInTheDocument();
  });
  it('cria nota privada por padrão sobre a decisão do slide',async()=>{
    const user=userEvent.setup();
    render(<PlaybookLibrary/>);
    await user.click(screen.getByRole('button',{name:'Iniciar apresentação'}));
    await user.click(screen.getByRole('button',{name:'Mostrar anotações'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:/Anotar decisão deste slide/i})).toBeEnabled());
    await user.click(screen.getByRole('button',{name:/Anotar decisão deste slide/i}));
    expect(screen.getByText(slides[0].decision,{selector:'blockquote'})).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('O que vale lembrar ou aplicar?'),'Exemplo para revisão da equipe.');
    await user.click(screen.getByRole('button',{name:'Salvar destaque'}));
    await waitFor(()=>expect(saveAnnotation).toHaveBeenCalledWith(userId,expect.objectContaining({slide_id:'01',quote:slides[0].decision}),'Exemplo para revisão da equipe.','private','yellow'));
    expect(await screen.findByText('Exemplo para revisão da equipe.')).toBeInTheDocument();
  });
});
