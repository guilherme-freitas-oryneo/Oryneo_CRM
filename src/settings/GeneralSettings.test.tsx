import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GeneralSettings } from './GeneralSettings';
import { loadAiSettings, saveAiSettings, testAiSettings } from './api';

vi.mock('./api',()=>({loadAiSettings:vi.fn(),saveAiSettings:vi.fn(),testAiSettings:vi.fn()}));

describe('GeneralSettings',()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(loadAiSettings)
   .mockResolvedValueOnce({provider:'openai',model:'gpt-5-mini',mode:'off',system_prompt:'Você é o SDR da ORYNEO e conduz cada contato com clareza e educação.',api_key_last_four:null})
   .mockResolvedValue({provider:'openai',model:'gpt-5-mini',mode:'off',system_prompt:'Você é o SDR da ORYNEO e conduz cada contato com clareza e educação.',api_key_last_four:'6789'});
  vi.mocked(saveAiSettings).mockResolvedValue();
  vi.mocked(testAiSettings).mockResolvedValue('conexão confirmada.');
 });
 it('salva a chave sem tentar relê-la e permite testar a conexão',async()=>{
  render(<GeneralSettings/>);
  const key=await screen.findByLabelText('Chave da API');
  await userEvent.type(key,'sk-test-secret-key-123456789');
  await userEvent.click(screen.getByRole('button',{name:'Salvar ajustes'}));
  expect(saveAiSettings).toHaveBeenCalledWith(expect.objectContaining({apiKey:'sk-test-secret-key-123456789'}));
  await userEvent.click(screen.getByRole('button',{name:'Testar conexão'}));
  expect(await screen.findByText('conexão confirmada.')).toBeInTheDocument();
 });
});
