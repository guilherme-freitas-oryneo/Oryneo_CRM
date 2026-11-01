import {describe,it,expect} from 'vitest';
import {NODE_KINDS,NODE_REGISTRY} from './nodeRegistry';
import {RUNTIME_CAPABILITIES,explainRuntimeCapability} from './runtimeReadiness';

describe('ORYNEO node readiness disclosure (UI only)',()=>{
 it('covers every registered node with an explicit capability',()=>{
  expect(Object.keys(RUNTIME_CAPABILITIES).sort()).toEqual([...NODE_KINDS].sort());
  for(const type of NODE_KINDS)expect(explainRuntimeCapability(type).length).toBeGreaterThan(60);
 });
 it('never represents any external communication as live',()=>{
  for(const type of NODE_KINDS.filter(t=>NODE_REGISTRY[t].family==='communication'))
   expect(RUNTIME_CAPABILITIES[type]).toBe('blocked_live');
 });
 it('requires controlled cutover for CRM mutations',()=>{
  expect(RUNTIME_CAPABILITIES.crm_task).toBe('controlled_crm');
  expect(RUNTIME_CAPABILITIES.crm_stage_change).toBe('controlled_crm');
  expect(RUNTIME_CAPABILITIES.crm_update).toBe('blocked_live');
 });
 it('does not imply productive AI or wait executors',()=>{
  expect(RUNTIME_CAPABILITIES.ai_generate).toBe('blocked_live');
  expect(RUNTIME_CAPABILITIES.wait).toBe('shadow_only');
 });
});
