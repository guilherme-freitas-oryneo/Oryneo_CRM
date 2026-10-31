import {
 requestAiReply,AiProviderError,type AiRequest,
} from '../_shared/whatsapp/aiProvider.ts';
import {
 processAiJob,type AiJobRecord,type AiJobContext,type AiJobDependencies,
} from '../_shared/whatsapp/aiJobProcessor.ts';

const check=(v:boolean,why:string)=>{if(!v)throw new Error(why)};
const input:AiRequest={
 provider:'openai',apiKey:'local-fixture-not-real',model:'gpt-5-mini',
 systemPrompt:'Testing only. Do not send.',messages:[{role:'user',content:'Olá'}],
};
const json=(status:number,payload:unknown)=>async()=>new Response(JSON.stringify(payload),{
 status,headers:{'Content-Type':'application/json'},
});
async function expectCode(run:()=>Promise<unknown>,code:string,retryable:boolean){
 try{await run();throw Error('EXPECTED_ERROR_MISSING');}
 catch(e){
   check(e instanceof AiProviderError, 'Unclassified provider exception '+String(e));
   check(e.code===code, 'Expected '+code+', received '+e.code);
   check(e.retryable===retryable, 'Retry policy mismatch for '+code);
 }
}
Deno.test('SDR S04: HTTP 200 incomplete/max_output_tokens is never sent',async()=>{
 await expectCode(()=>requestAiReply(input,json(200,{
   id:'resp_incomplete',status:'incomplete',
   incomplete_details:{reason:'max_output_tokens'},
   output:[{type:'message',content:[{type:'output_text',text:'Partial offer'}]}],
 })),'AI_INCOMPLETE_MAX_OUTPUT_TOKENS',true);
 await expectCode(()=>requestAiReply(input,json(200,{
   id:'resp_bad',status:'incomplete',
   incomplete_details:{reason:'content_filter'},output:[],
 })),'AI_INCOMPLETE',true);
});
Deno.test('SDR S05: HTTP 200 no usable assistant text is retriable, never fabricated',async()=>{
 await expectCode(()=>requestAiReply(input,json(200,{
   id:'resp_empty',status:'completed',
   output:[{type:'reasoning',summary:[]}],
 })),'AI_EMPTY_RESPONSE',true);
});
Deno.test('SDR S06: provider 429/5xx/401 respect distinct backoff policy',async()=>{
 await expectCode(()=>requestAiReply(input,json(429,{error:{code:'rate_limit_exceeded'}})),
   'AI_PROVIDER_RATE_LIMITED',true);
 await expectCode(()=>requestAiReply(input,json(503,{error:{code:'unavailable'}})),
   'AI_PROVIDER_UNAVAILABLE',true);
 await expectCode(()=>requestAiReply(input,json(401,{error:{code:'bad_credentials'}})),
   'AI_PROVIDER_AUTH',false);
});
Deno.test('SDR: completed Responses output can be extracted without any external API request',async()=>{
 const response=await requestAiReply(input,json(200,{
   id:'resp_demo',status:'completed',output:[
     {type:'reasoning',summary:[]},
     {type:'message',role:'assistant',
       content:[{type:'output_text',text:'Como vocês acompanham os leads hoje?'}]},
   ],
 }));
 check(response.providerResponseId==='resp_demo','provider trace ID lost');
 check(response.text==='Como vocês acompanham os leads hoje?','wrong assistant reply');
});
const at=new Date('2026-10-30T19:00:00.000Z');
const job:AiJobRecord={
 id:'job-1',channelId:'channel-1',conversationId:'conversation-1',
 inboundMessageId:'inbound-1',leaseToken:'lease-1',attempts:1,
};
const base=():AiJobContext=>({
 channelEnabled:true,conversationMode:'sdr_active',optedOut:false,
 consentGranted:true,lastInboundAt:'2026-10-30T18:59:00.000Z',
 globalMode:'auto',latestInboundMessageId:'inbound-1',
 provider:'openai',model:'gpt-5-mini',apiKey:'local-fixture',
 systemPrompt:'Operational policy',trainingPrompt:'Approved release fixture',
 attachmentText:'',messages:[{role:'user',content:'Olá'}],
});
Deno.test('SDR: no silent loss when generation fails after valid inbound lease',async()=>{
 let failure:string|null=null;let generateCalls=0;let sent=false;
 const dependencies:AiJobDependencies={
   now:()=>at,loadContext:async()=>base(),
   generate:async()=>{generateCalls++;throw new AiProviderError('AI_PROVIDER_RATE_LIMITED',true,429);},
   completeGeneration:async()=>{sent=true;return 'generated';},
   completeFailure:async i=>{failure=i.errorCode;check(i.retryable,'429 must retry');return 'retry_wait';},
   cancel:async()=> 'cancelled',
 };
 const d=await processAiJob(job,dependencies);
 check(d.state==='retry_wait'&&'reason' in d&&d.reason==='AI_PROVIDER_RATE_LIMITED','job disappeared instead of retry');
 check(generateCalls===1&&failure==='AI_PROVIDER_RATE_LIMITED'&&!sent,'incorrect side effect');
});
Deno.test('SDR: takeover, review, closed, opt-out and newer inbound prevent any generation',async()=>{
 for(const mutation of [
  (c:AiJobContext)=>{c.conversationMode='human_locked';},
  (c:AiJobContext)=>{c.conversationMode='review';},
  (c:AiJobContext)=>{c.conversationMode='resolved';},
  (c:AiJobContext)=>{c.optedOut=true;},
  (c:AiJobContext)=>{c.consentGranted=false;},
  (c:AiJobContext)=>{c.latestInboundMessageId='inbound-2';},
 ]){
   const context=base();mutation(context);
   let generations=0,cancellations=0;
   const deps:AiJobDependencies={
     now:()=>at,loadContext:async()=>context,
     generate:async()=>{generations++;return {text:'Never send',providerResponseId:null};},
     completeGeneration:async()=>{throw Error('Unexpected output');},
     completeFailure:async()=>{throw Error('Unexpected failure');},
     cancel:async()=>{cancellations++;return 'cancelled';},
   };
   const result=await processAiJob(job,deps);
   check(['cancelled','superseded'].includes(result.state),'operator takeover not protected');
   check(generations===0&&cancellations===1,'generated after ineligibility');
 }
});
Deno.test('SDR: service window boundary blocks unattended generation',async()=>{
 const ctx=base();ctx.lastInboundAt='2026-10-29T18:59:00.000Z';
 let generated=false;
 const deps:AiJobDependencies={
  now:()=>at,loadContext:async()=>ctx,generate:async()=>{generated=true;throw Error('Unsafe');},
  completeGeneration:async()=>{throw Error('Unexpected output');},
  completeFailure:async()=>{throw Error('Unexpected failure');},
  cancel:async()=> 'cancelled',
 };
 const result=await processAiJob(job,deps);
 check(result.state==='cancelled'&&!generated,'outside-window reply attempted');
});
