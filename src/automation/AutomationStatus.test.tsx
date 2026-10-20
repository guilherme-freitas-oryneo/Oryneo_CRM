import {describe,expect,it} from 'vitest';
import {automationLabel,remainingTime,type AutomationJob} from './AutomationStatus';

const future='2026-10-20T12:05:00.000Z';
const now=Date.parse('2026-10-20T12:00:00.000Z');
const job=(state:AutomationJob['state']):Pick<AutomationJob,'state'|'due_at'|'completed_at'>=>({
 state,due_at:future,completed_at:null
});

describe('cronômetro de comunicação automática',()=>{
 it('exibe tempo a vencer sem antecipar o envio',()=>{
  expect(remainingTime(future,now)).toBe('05:00');
  expect(remainingTime(future,now+61000)).toBe('03:59');
  expect(remainingTime(future,now+300000)).toBe('Aguardando processamento');
 });
 it('diferencia agendado, retry e conciliação sem simular envio',()=>{
  expect(automationLabel(job('scheduled'),now)).toBe('Envio automático em 05:00');
  expect(automationLabel(job('failed'),now)).toBe('Nova tentativa em 05:00');
  expect(automationLabel(job('reconciliation'),now)).toBe('Aguardando conciliação do envio');
  expect(automationLabel(job('sent'),now)).toBe('Enviado');
  expect(automationLabel(job('dead'),now)).toBe('Tentativas encerradas — requer revisão');
 });
 it('trata prazo inválido sem exibir NaN ou contagem regressiva enganosa',()=>{
  expect(remainingTime('invalido',now)).toBe('Prazo indisponível');
 });
});
