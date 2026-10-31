/** Stage5 controlled SDR integration harness. No API requests, Meta sends or user data. */
import {processAiJob,type AiJobRecord,type AiJobContext,type AiJobDependencies} from '../_shared/whatsapp/aiJobProcessor.ts';
import {classifySdrIntent,type IntentDictionary} from '../_shared/sdr/intentPolicy.ts';
import candidate from '../../automation/sdr_intent_candidate.v1.json' with {type:'json'};
const expect=(condition:unknown,why:string)=>{if(!condition)throw Error(why)};
const at=new Date('2026-10-31T17:00:00.000Z');
const dictionary:IntentDictionary={releaseVersion:1,language:'pt_BR',
 entries:candidate.entries.map(e=>({...e,risk:e.risk as 'normal'|'human_review'}))};
const job=(inbound:string):AiJobRecord=>({id:'job-'+inbound,channelId:'local',
 conversationId:'local-conversation',inboundMessageId:inbound,leaseToken:'lease-'+inbound,attempts:1});
const context=(inbound:string):AiJobContext=>({
 channelEnabled:true,conversationMode:'sdr_active',optedOut:false,consentGranted:true,
 lastInboundAt:'2026-10-31T16:58:00.000Z',globalMode:'auto',
 latestInboundMessageId:inbound,provider:'openai',model:'local-mock',apiKey:'never-used',
 systemPrompt:'System instructions: validate canonical release',trainingPrompt:'Preserved legacy SDR',
 authoritativeTraining:'Approved Playbook v1.0.0 for isolated test only',
 attachmentText:'',messages:[{role:'user',content:'Oi'}],
});
function fixture(load:(j:AiJobRecord)=>AiJobContext){
 const calls={generation:0,completion:0,failure:0,cancellation:0};
 const deps:AiJobDependencies={
  now:()=>at,
  loadContext:async j=>load(j),
  generate:async()=>{calls.generation++;return {text:'Olá, qual é o contexto da operação?',providerResponseId:'resp-local'};},
  completeGeneration:async()=>{calls.completion++;return 'generated';},
  completeFailure:async i=>{calls.failure++;return i.retryable?'retry_wait':'human_review';},
  cancel:async()=>{calls.cancellation++;return 'superseded';},
 };
 return {calls,deps};
}
Deno.test('S01: eligible persisted mock inbound generates exactly one candidate answer, without Meta I/O',async()=>{
 const f=fixture(()=>context('1'));
 const result=await processAiJob(job('1'),f.deps);
 expect(result.state==='generated','Inbound job not finalized');
 expect(f.calls.generation===1&&f.calls.completion===1,'Duplicated AI candidate');
});
Deno.test('S02/S03: resumed inbound after hours with unapproved grace/cancel terms routes to human with durable failure state',async()=>{
 for(const text of ['Tem carência de uso?','Posso cancelar quando quiser?']){
  const intent=classifySdrIntent(text,dictionary);
  expect(intent.humanReview,'Legal question did not enter guarded path: '+text);
  const f=fixture(()=>({...context('2'),lastInboundAt:'2026-10-31T16:59:00Z',
   messages:[{role:'user',content:text}],policyHumanReview:intent.humanReview}));
  const result=await processAiJob(job('2'),f.deps);
  expect(result.state==='human_review','No recoverable handoff status: '+text);
  expect(f.calls.generation===0&&f.calls.completion===0&&f.calls.failure===1,
   'Unsupported terms generated without human verification');
 }
});
Deno.test('S08: three messages quickly supersede two stale jobs; only newest can be generated',async()=>{
 const f=fixture(j=>({...context('3'),latestInboundMessageId:'3',
  messages:[{role:'user',content:'Quero agendar uma demonstração'}]}));
 const results=await Promise.all([processAiJob(job('1'),f.deps),
  processAiJob(job('2'),f.deps),processAiJob(job('3'),f.deps)]);
 expect(results[0].state==='superseded'&&results[1].state==='superseded',
  'Earlier inbound jobs were not superseded');
 expect(results[2].state==='generated','Latest job did not win');
 expect(f.calls.generation===1&&f.calls.completion===1,'AI generated a duplicate reply');
});
Deno.test('S09/S10/S11: takeover, review, resolved and opt-out cannot generate even with good prompts',async()=>{
 for(const change of [{conversationMode:'human_locked' as const},
  {conversationMode:'review' as const},{conversationMode:'resolved' as const},
  {optedOut:true},{consentGranted:false},{globalMode:'suggest' as const}]){
  const f=fixture(()=>({...context('1'),...change}));
  const d=await processAiJob(job('1'),f.deps);
  expect(d.state==='cancelled','Protected contact accepted AI work: '+JSON.stringify(change));
  expect(f.calls.generation===0&&f.calls.completion===0,'Blocked contact generated reply');
 }
});
Deno.test('S09: takeover during AI generation leaves stale candidate, never an automatic send',async()=>{
 const f=fixture(()=>context('1'));let owner:'sdr'|'human'='sdr';
 f.deps.generate=async()=>{f.calls.generation++;owner='human';return {
  text:'Candidate never sent',providerResponseId:'resp-local-takeover'};};
 f.deps.completeGeneration=async()=>{f.calls.completion++;return owner==='human'?'stale':'generated';};
 const d=await processAiJob(job('1'),f.deps);
 expect(d.state==='stale','Post-generation takeover did not mark stale');
 expect(f.calls.generation===1&&f.calls.completion===1,'Incorrect post-generation CAS behavior');
});
Deno.test('C01: free reply context expires when inbound exceeds 24h; no provider request',async()=>{
 const f=fixture(()=>({...context('1'),lastInboundAt:'2026-10-30T16:59:59.999Z'}));
 const d=await processAiJob(job('1'),f.deps);
 expect(d.state==='cancelled','Expired conversation failed closed');
 expect(f.calls.generation===0,'Expired session reached model');
});
