import { describe, it, expect } from 'vitest';
import { duplicateDealData, actionBucket } from './pipeline';
import type { DealRow } from './data';
const row = {id:'original', data:{title:'Projeto',company:'Empresa',contact:'Ana',email:'ana@example.com',phone:'123',value_cents:100,stage_id:'won',notes:'Histórico antigo',source:'Landing page',due_date:'2025-01-01',first_contact:{sent_at:'ontem'},next_action:{title:'Concluída',done:true},quote:{plan:'Scale'},form_submission:{intent:'contratar'},company_cnpj:'123'}} as unknown as DealRow;
describe('duplicação comercial',()=>{
 it('copia cadastro sem carregar estados e histórico do original',()=>{
  const copy=duplicateDealData(row,'open');
  expect(copy).toMatchObject({title:'Projeto · cópia',company:'Empresa',email:'ana@example.com',stage_id:'open',source:'Duplicação',duplicated_from:'original',due_date:'',notes:'',next_action:{done:false,due_at:null}});
  expect(copy).not.toHaveProperty('first_contact');expect(copy).not.toHaveProperty('quote');expect(copy).not.toHaveProperty('form_submission');
  expect(row.data.stage_id).toBe('won');
 });
 it('separa atividades vencidas, sem ação e concluídas',()=>{
  expect(actionBucket({...row.data,next_action:{title:'Ligar',done:false,due_at:'2026-01-01T12:00:00Z'}},new Date('2026-02-01'))).toBe('overdue');
  expect(actionBucket({...row.data,due_date:'',next_action:{title:'',done:false}},new Date())).toBe('unscheduled');
  expect(actionBucket({...row.data,next_action:{title:'Feito',done:true}},new Date())).toBe('done');
 });
});
