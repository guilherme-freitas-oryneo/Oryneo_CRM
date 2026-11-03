import { shadowSafeState } from '../automation-shadow-worker/safeState.ts';

const assert=(value:boolean,message:string)=>{if(!value)throw new Error(message);};

Deno.test('known stopped shadow states are healthy, fixed-code no-ops',()=>{
  const state=shadowSafeState({code:'42501',message:'SHADOW_RUNTIME_DISABLED'});
  assert(state?.code==='SHADOW_RUNTIME_DISABLED','disabled runtime must be a healthy no-op');
  assert(!JSON.stringify(state).includes('message'),'safe state leaked error text');
});

Deno.test('permission and unknown failures remain failures',()=>{
  assert(shadowSafeState({code:'42501',message:'permission denied for table crm_events'})===null,
    'a missing required permission must remain visible');
  assert(shadowSafeState(new Error('customer@example.com'))===null,
    'arbitrary errors must never be classified as safe');
});
