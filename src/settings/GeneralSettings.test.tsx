import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultTraining, GeneralSettings } from './GeneralSettings';
import { loadAiSettings, saveAiSettings, testAiSettings } from './api';

vi.mock('./api',()=>({loadAiSettings:vi.fn(),saveAiSettings:vi.fn(),testAiSettings:vi.fn()}));
const settings={provider:'openai' as const,model:'gpt-5-mini',mode:'off' as const,system_prompt:'Você é o SDR da ORYNEO e conduz cada contato com clareza e educação.',training_config:defaultTraining,api_key_last_four:null};

describe('GeneralSettings',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(loadAiSettings).mockResolvedValueOnce(settings).mockResolvedValue({...settings,api_key_last_four:'6789'});
  vi.mocked(saveAiSettings).mockResolvedValue();
  vi.mocked(testAiSettings).mockResolvedValue('conexão confirmada.');
 });
 it('expõe provedor, token e treinamento em campos identificados',async()=>{
  render(<GeneralSettings/>);
  expect(await screen.findByRole('heading',{name:'IA e SDR'})).toBeInTheDocument();
  expect(screen.getByLabelText('Provedor de IA')).toHaveValue('openai');
  expect(screen.getByLabelText('Chave da API')).toBeInTheDocument();
  expect(screen.getByLabelText('Contexto do negócio')).toHaveValue(defaultTraining.business_context);
  expect(screen.getByLabelText('Perguntas de qualificação')).toBeInTheDocument();
  expect(screen.getByLabelText('Regra de transferência')).toBeInTheDocument();
 });
 it('salva token e treinamento sem tentar reler a chave',async()=>{
  const user=userEvent.setup();
  render(<GeneralSettings/>);
  const key=await screen.findByLabelText('Chave da API');
  await user.clear(screen.getByLabelText('Tom de voz'));
  await user.type(screen.getByLabelText('Tom de voz'),'Próximo, consultivo e objetivo.');
  await user.type(key,'sk-test-secret-key-123456789');
  await user.click(screen.getByRole('button',{name:'Salvar configuração'}));
  expect(saveAiSettings).toHaveBeenCalledWith(expect.objectContaining({apiKey:'sk-test-secret-key-123456789',trainingConfig:expect.objectContaining({tone:'Próximo, consultivo e objetivo.'})}));
  expect(await screen.findByText('Configuração e treinamento salvos com segurança.')).toBeInTheDocument();
 });
 it('salva e testa uma chave nova em uma única ação',async()=>{
  const user=userEvent.setup();
  render(<GeneralSettings/>);
  await user.type(await screen.findByLabelText('Chave da API'),'sk-test-secret-key-123456789');
  await user.click(screen.getByRole('button',{name:'Salvar e testar nova chave'}));
  expect(saveAiSettings).toHaveBeenCalled();
  expect(testAiSettings).toHaveBeenCalled();
  expect(await screen.findByText('conexão confirmada.')).toBeInTheDocument();
 });
});
