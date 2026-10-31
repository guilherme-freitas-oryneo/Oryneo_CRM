import {describe,expect,it} from 'vitest';
import {buildSimulationCase,SIMULATION_CASES} from './simulationCases';
describe('non-emitting hypothetical automation contexts',()=>{
 it('offers distinct scenario selectors without real customer identity',()=>{
  expect(SIMULATION_CASES).toHaveLength(6);
  expect(new Set(SIMULATION_CASES.map(c=>c.id)).size).toBe(6);
  for(const item of SIMULATION_CASES){
   const context=buildSimulationCase(item.id);
   const body=JSON.stringify(context);
   expect(body).not.toMatch(/email|phone|cpf|cnpj|wa_id|access_token|customer_id/i);
   expect(body.length).toBeLessThan(1024);
   expect(context).not.toHaveProperty('event');
  }
 });
 it('does not confuse pending checkout with paid webhook hypothesis',()=>{
  expect(buildSimulationCase('payment_pending')).toEqual({
   billing:{status:'pending',paid_verified:false},
  });
  expect(buildSimulationCase('payment_verified')).toEqual({
   billing:{status:'paid',paid_verified:true},
  });
 });
 it('distinguishes human handoff from active SDR',()=>{
  expect(buildSimulationCase('human_locked')).toEqual({
   conversation:{mode:'human_locked',opted_out:true,consent_granted:false},
  });
  expect(buildSimulationCase('sdr_active')).toEqual({
   conversation:{mode:'sdr_active',opted_out:false,consent_granted:true},
  });
 });
 it('returns no context by default and rejects unknown options',()=>{
  expect(buildSimulationCase('unknown')).toEqual({});
  expect(()=>buildSimulationCase('unspecified' as never)).toThrow('UNKNOWN_SIMULATION_CASE');
 });
});