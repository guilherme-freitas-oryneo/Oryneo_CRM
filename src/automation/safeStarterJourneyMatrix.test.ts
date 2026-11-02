import {describe,it,expect} from 'vitest';
import {STARTER_FLOWS} from './starterFlows';
import {buildCrmReviewStarter} from './safeStarterActionPlans';
import {simulateFlow,validateFlow} from './flowDefinition';
type Context = Record<string,unknown>;
const cases:Record<string,{yes:Context;no:Context;wait?:boolean}>={
 new_opportunity:{
  yes:{opportunity:{stage_id:'88888888-8888-4888-8888-888888888888'}},
  no:{opportunity:{}},
 },
 talk_to_us:{
  yes:{conversation:{mode:'sdr_active'}},
  no:{conversation:{mode:'human_locked'}},
 },
 direct_checkout:{
  yes:{billing:{status:'awaiting_payment'}},
  no:{billing:{}},
 },
 payment_confirmed:{
  yes:{billing:{paid_verified:true}},
  no:{billing:{paid_verified:false}},
 },
 diagnosis:{
  yes:{opportunity:{stage_id:'88888888-8888-4888-8888-888888888888'}},
  no:{opportunity:{}},
 },
 proposal:{
  yes:{opportunity:{stage_id:'88888888-8888-4888-8888-888888888888'}},
  no:{opportunity:{}},
 },
 follow_up:{
  yes:{conversation:{consent_granted:true}},
  no:{conversation:{consent_granted:false}},
  wait:true,
 },
 conversational_sdr:{
  yes:{conversation:{mode:'sdr_active'}},
  no:{conversation:{mode:'review'}},
 },
};
describe('ORYNEO eight CRM review journeys decision matrix',()=>{
 it('has a grounded positive and negative scenario for every ZIP starter',()=>{
  expect(Object.keys(cases).sort()).toEqual(STARTER_FLOWS.map(x=>x.id).sort());
 });
 for(const starter of STARTER_FLOWS){
  it(starter.id+' handles approved and blocked paths without external dispatch',()=>{
   const flow=buildCrmReviewStarter(starter.id);
   expect(validateFlow(flow).ok).toBe(true);
   const good=simulateFlow(flow,{eventType:starter.event,context:cases[starter.id].yes});
   const bad=simulateFlow(flow,{eventType:starter.event,context:cases[starter.id].no});
   expect(good.dryRun).toBe(true);
   expect(bad.dryRun).toBe(true);
   expect(good.issues).toEqual([]);
   expect(bad.issues).toEqual([]);
   expect(bad.trace.some(x=>x.type==='crm_task')).toBe(false);
   expect(bad.trace.at(-1)?.type).toBe('stop');
   if(cases[starter.id].wait){
    expect(good.trace.at(-1)?.status).toBe('waiting');
    expect(good.trace.some(x=>x.type==='crm_task')).toBe(false);
   }else{
    expect(good.trace.some(x=>x.type==='crm_task'&&x.status==='planned')).toBe(true);
    expect(good.trace.at(-1)?.type).toBe('end');
   }
  });
  it(starter.id+' fails closed on wrong canonical trigger',()=>{
   const flow=buildCrmReviewStarter(starter.id);
   const wrong=simulateFlow(flow,{eventType:'not.a.canonical.event',context:cases[starter.id].yes});
   expect(wrong.issues.map(x=>x.code)).toContain('EVENT_NOT_MATCHED');
   expect(wrong.trace).toEqual([]);
  });
 }
});
