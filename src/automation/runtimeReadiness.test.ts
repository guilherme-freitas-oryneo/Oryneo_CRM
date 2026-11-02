import {describe,it,expect} from 'vitest';
import {NODE_KINDS} from './nodeRegistry';
import {RUNTIME_CAPABILITIES,explainRuntimeCapability} from './runtimeReadiness';

describe('ORYNEO node readiness disclosure (UI only)',()=>{
 it('covers every registered node with an explicit capability',()=>{
  expect(Object.keys(RUNTIME_CAPABILITIES).sort()).toEqual([...NODE_KINDS].sort());
  for(const type of NODE_KINDS)expect(explainRuntimeCapability(type).length).toBeGreaterThan(60);
 });
 it('discloses reviewed dormant channel adapters without claiming live availability',()=>{
  expect(RUNTIME_CAPABILITIES.whatsapp_template).toBe('controlled_channel');
  expect(RUNTIME_CAPABILITIES.whatsapp_reply).toBe('controlled_channel');
  expect(RUNTIME_CAPABILITIES.email).toBe('controlled_channel');
  expect(RUNTIME_CAPABILITIES.notify).toBe('blocked_live');
 });
 it('requires controlled cutover for CRM mutations',()=>{
  expect(RUNTIME_CAPABILITIES.crm_task).toBe('controlled_crm');
  expect(RUNTIME_CAPABILITIES.crm_stage_change).toBe('controlled_crm');
  expect(RUNTIME_CAPABILITIES.crm_update).toBe('blocked_live');
 });
 it('distinguishes durable waits from unavailable AI execution',()=>{
  expect(RUNTIME_CAPABILITIES.ai_generate).toBe('blocked_live');
  expect(RUNTIME_CAPABILITIES.wait).toBe('durable_control');
 });
});
