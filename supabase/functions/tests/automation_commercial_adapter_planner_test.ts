import {planCommercialHandoff,type HandoffRequest} from '../automation-api/commercialAdapterPlanner.ts';
import type {CommercialEvidence} from '../automation-api/commercialActionPolicy.ts';
const UUID_A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID_C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UUID_D='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const KEY='f'.repeat(64);
const request:HandoffRequest={
 workspaceId:UUID_A,flowVersionId:UUID_B,nodeId:UUID_C,actionKey:KEY,
 actionType:'whatsapp_template',refs:{conversation_id:UUID_D},
};
const safe:CommercialEvidence={
 actionType:'whatsapp_template',workspaceActive:true,mode:'live',
 emergencyStop:false,versionPublished:true,graphNodeTypeMatches:true,
 actionLeaseFenced:true,channelOwner:'new_engine',providerConfigured:true,
 consentVerified:true,optedOut:false,conversationMode:'sdr_active',
 canonicalInboundWithin24h:true,metaTemplateApprovedAndComponentsVerified:true,
 mailRecipientVerified:true,canonicalStageIsAllowed:true,
};
function assert(ok:unknown,message:string):asserts ok{if(!ok)throw Error(message);}
Deno.test('Stage3: WhatsApp handoff is stable across retry without sending',async()=>{
 const a=await planCommercialHandoff(request,safe);
 const b=await planCommercialHandoff(request,safe);
 assert(a.status==='prepared','Valid canonical handoff rejected');
 assert(a.channel==='whatsapp'&&a.sourceRefId===UUID_D,'Wrong canonical channel');
 assert(a.deduplicationKey?.length===64,'Missing stable hash');
 assert(a.deduplicationKey===b.deduplicationKey,'Retry would create second handoff');
 assert(a.dispatchAuthorized===false,'Preparation cannot authorize Meta transport');
});
Deno.test('Stage3: distinct nodes/versions cannot share deduplication identity',async()=>{
 const a=await planCommercialHandoff(request,safe);
 const b=await planCommercialHandoff({...request,nodeId:UUID_D},safe);
 assert(a.deduplicationKey!==b.deduplicationKey,'Cross-node deduplication collision');
});
Deno.test('Stage3: email uses only canonical opportunity ref (not recipient addresses)',async()=>{
 const result=await planCommercialHandoff({
  ...request,actionType:'email',refs:{opportunity_id:UUID_D},
 },{...safe,actionType:'email'});
 assert(result.status==='prepared'&&result.channel==='email','Email route invalid');
 assert(JSON.stringify(result).indexOf('@')===-1,'Private recipient leaked');
 assert(result.dispatchAuthorized===false,'Unexpected SMTP send authorization');
});
Deno.test('Stage3: CRM stage change uses canonical opportunity and exclusive owner',async()=>{
 const result=await planCommercialHandoff({
  ...request,actionType:'crm_stage_change',refs:{opportunity_id:UUID_D},
 },{...safe,actionType:'crm_stage_change'});
 assert(result.status==='prepared'&&result.channel==='crm','CRM route invalid');
});
Deno.test('Stage3: billing is never queued from a canvas',async()=>{
 const result=await planCommercialHandoff({
  ...request,actionType:'billing_read',refs:{order_id:UUID_D},
 },{...safe,actionType:'billing_read'});
 assert(result.status==='rejected'&&!result.deduplicationKey,'Billing action was queued');
});
Deno.test('Stage3: prevent personal fields and forged reference IDs',async()=>{
 const result=await planCommercialHandoff({
  ...request,refs:{conversation_id:UUID_D,customer_wa_id:'5521000000000'},
 } as HandoffRequest,safe);
 assert(result.status==='rejected','Customer phone slipped into event refs');
 const noId=await planCommercialHandoff({...request,refs:{conversation_id:'fake'}},safe);
 assert(noId.status==='rejected','Invalid UUID accepted');
});
Deno.test('Stage3: wrong type and immutable identity block handoff',async()=>{
 const type=await planCommercialHandoff({...request,actionType:'email'},safe);
 const id=await planCommercialHandoff({...request,flowVersionId:'not-uuid'},safe);
 assert(type.status==='rejected'&&id.status==='rejected','Unverified action admitted');
});
Deno.test('Stage3: disable runtime, legacy ownership and human takeover deny handoff',async()=>{
 for(const evidence of [
  {...safe,mode:'shadow' as const},
  {...safe,emergencyStop:true},
  {...safe,channelOwner:'legacy' as const},
  {...safe,consentVerified:false},
  {...safe,conversationMode:'human_locked' as const},
  {...safe,metaTemplateApprovedAndComponentsVerified:false},
 ]){
  const result=await planCommercialHandoff(request,evidence);
  assert(result.status==='rejected'&&result.dispatchAuthorized===false,
   'Forbidden provider handoff was prepared');
 }
});
Deno.test('Stage3: missing canonical source prevents queued delivery',async()=>{
 const result=await planCommercialHandoff({...request,refs:{opportunity_id:UUID_D}},safe);
 assert(result.status==='rejected','WhatsApp without canonical conversation allowed');
});
