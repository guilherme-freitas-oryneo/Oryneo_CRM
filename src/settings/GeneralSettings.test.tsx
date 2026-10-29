import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneralSettings } from './GeneralSettings';
import { loadAiSettings, saveAiSettings, testAiSettings } from './api';

vi.mock('./api',()=>({loadAiSettings:vi.fn(),saveAiSettings:vi.fn(),testAiSettings:vi.fn(),uploadAiAttachment:vi.fn(),removeAiAttachment:vi.fn()}));
const settings={provider:'openai' as const,model:'gpt-5-mini',mode:'off' as const,system_prompt:'Você é o SDR da ORYNEO e conduz cada contato com clareza e educação.',training_prompt:'Treinamento geral da ORYNEO com links e regras.',training_config:{business_context:'',tone:'',objective:'',qualification_questions:'',guardrails:'',handoff_rule:''},api_key_last_four:null,attachments:[],health:{queued:2,retrying:1,uncertain:3,human_review:4}};

describe('GeneralSettings',()=>{
 beforeEach(()=>{vi.clearAllMocks();vi.mocked(loadAiSettings).mockResolvedValueOnce(settings).mockResolvedValue({...settings,api_key_last_four:'6789'});vi.mocked(saveAiSettings).mockResolvedValue();vi.mocked(testAiSettings).mockResolvedValue('conexão confirmada.')});
 it('expõe provedor, chave, treinamento geral e anexos em uma interface simples',async()=>{render(<GeneralSettings/>);expect(await screen.findByRole('heading',{name:'IA e SDR'})).toBeInTheDocument();expect(screen.getByLabelText('Provedor de IA')).toHaveValue('openai');expect(screen.getByLabelText('Chave da API')).toBeInTheDocument();expect(screen.getByLabelText('Treinamento geral do SDR')).toHaveValue(settings.training_prompt);expect(screen.getByRole('button',{name:'Adicionar anexo'})).toBeInTheDocument()});
 it('salva o treinamento geral sem tentar reler a chave',async()=>{const user=userEvent.setup();render(<GeneralSettings/>);await user.clear(await screen.findByLabelText('Treinamento geral do SDR'));await user.type(screen.getByLabelText('Treinamento geral do SDR'),'Use este link https://oryneo.com.br e conduza para diagnóstico.');await user.click(screen.getByRole('button',{name:'Salvar configuração'}));expect(saveAiSettings).toHaveBeenCalledWith(expect.objectContaining({trainingPrompt:'Use este link https://oryneo.com.br e conduza para diagnóstico.'}));expect(await screen.findByText('Treinamento e configuração salvos com segurança.')).toBeInTheDocument()});
 it('permite escolher o modo de resposta automática',async()=>{const user=userEvent.setup();render(<GeneralSettings/>);await user.selectOptions(await screen.findByLabelText('Modo de operação'),'auto');expect(screen.getByLabelText('Modo de operação')).toHaveValue('auto')});
 it('mostra somente totais operacionais da fila sem dados de contatos',async()=>{render(<GeneralSettings/>);expect(await screen.findByRole('heading',{name:'Saúde da automação'})).toBeInTheDocument();expect(screen.getByText('2 aguardando')).toBeInTheDocument();expect(screen.getByText('1 repetindo')).toBeInTheDocument();expect(screen.getByText('3 incertos')).toBeInTheDocument();expect(screen.getByText('4 em revisão')).toBeInTheDocument();expect(screen.queryByText(/telefone|mensagem do cliente/i)).not.toBeInTheDocument()});
});
