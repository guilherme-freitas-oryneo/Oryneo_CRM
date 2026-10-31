import {parseSimulationFixture} from '../automation-api/simulationBoundary.ts';
const assert=(condition:boolean,why:string)=>{if(!condition)throw Error(why);};
const types=['conversation.inbound','billing.paid_verified','opportunity.created'];
Deno.test('simulation allows small typed hypothetical values without sending',()=>{
 const c=parseSimulationFixture({conversation:{
   mode:'sdr_active',consent_granted:true,opted_out:false,
 }},'conversation.inbound',types);
 assert(c.ok,'Valid explicit fixture rejected');
 if(c.ok){
  assert(c.fixture.event.type==='conversation.inbound','Server event was not set');
  assert(c.fixture.conversation!==undefined,'Safe conversation disappeared');
  assert(!Object.hasOwn(c.fixture,'phone'),'Sensitive data appeared');
 }
});
Deno.test('simulation denies invented event, PII and wrong types',()=>{
 const bad=[
  [{conversation:{customer_wa_id:'5521000000000'}},'conversation.inbound'],
  [{opportunity:{email:'a@example.com'}},'opportunity.created'],
  [{billing:{paid_verified:'true'}},'billing.paid_verified'],
  [{event:{type:'billing.paid_verified'}},'conversation.inbound'],
  [{conversation:{mode:'sdr_active',message_body:'private'}},'conversation.inbound'],
  [{conversation:{mode:'sdr_active\nDROP TABLE'}},'conversation.inbound'],
  [{__proto__:{mode:'sdr_active'}},'conversation.inbound'],
  [[], 'conversation.inbound'],
 ];
 for(const [sample,event] of bad){
  const input=parseSimulationFixture(sample,event,types);
  assert(!input.ok,'Untrusted fixture should be rejected');
 }
 assert(!parseSimulationFixture({},'admin.force_send',types).ok,
   'Unreviewed event was accepted');
});
Deno.test('simulation source status never produces a verified external payment',()=>{
 const result=parseSimulationFixture({billing:{
   status:'paid',paid_verified:true,
 }},'billing.paid_verified',types);
 assert(result.ok,'Typed financial hypothetical fixture rejected');
 if(result.ok){
  assert(result.fixture.billing!==undefined,'Hypothetical context missing');
  assert(!Object.hasOwn(result.fixture,'stripe_webhook_signature'),
   'Simulation accidentally manufactured payment signature');
 }
});
