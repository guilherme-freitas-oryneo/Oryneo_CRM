import {reviewCommercialAction,type CommercialEvidence} from '../automation-api/commercialActionPolicy.ts';
import type {CommercialCrmWorkerReport} from '../automation-commercial-crm-worker/index.ts';
function assert(condition:unknown,message:string):asserts condition{
 if(!condition)throw Error(message);
}
const base:CommercialEvidence={
 actionType:'whatsapp_template',workspaceActive:true,mode:'live',
 emergencyStop:false,versionPublished:true,graphNodeTypeMatches:true,
 actionLeaseFenced:true,channelOwner:'new_engine',
 providerConfigured:true,consentVerified:true,optedOut:false,
 conversationMode:'sdr_active',canonicalInboundWithin24h:true,
 metaTemplateApprovedAndComponentsVerified:true,
 mailRecipientVerified:true,canonicalStageIsAllowed:true,
};
Deno.test('Stage3: release preflight does NOT send even if all controls pass',()=>{
 const result=reviewCommercialAction(base);
 assert(result.eligibleForControlledQueue,'Approved preflight should qualify');
 assert(result.dispatchAuthorized===false,'Pure preflight cannot authorize transport');
 assert(result.code==='ELIGIBLE_BUT_NOT_DISPATCHED','Missing no-dispatch marker');
});
for(const [name,changes,reason] of [
 ['emergency stop',{emergencyStop:true},'EMERGENCY_STOP'],
 ['runtime disabled',{mode:'disabled'},'NOT_LIVE'],
 ['shadow not live',{mode:'shadow'},'NOT_LIVE'],
 ['inactive workspace',{workspaceActive:false},'NOT_LIVE'],
 ['unpublished draft',{versionPublished:false},'DRAFT_OR_MUTATED_VERSION'],
 ['graph node mismatch',{graphNodeTypeMatches:false},'DRAFT_OR_MUTATED_VERSION'],
 ['missing fence',{actionLeaseFenced:false},'LEASE_FENCE_REQUIRED'],
 ['legacy owns provider',{channelOwner:'legacy'},'LEGACY_EXECUTOR_OWNS_CHANNEL'],
 ['unverified owner',{channelOwner:'unverified'},'LEGACY_EXECUTOR_OWNS_CHANNEL'],
 ['provider missing',{providerConfigured:false},'PROVIDER_UNVERIFIED'],
 ['customer opted out',{optedOut:true},'OPTED_OUT'],
 ['opt-out unknown',{optedOut:undefined},'OPTED_OUT'],
 ['no consent',{consentVerified:false},'CONSENT_REQUIRED'],
 ['human takeover',{conversationMode:'human_locked'},'HUMAN_TAKEOVER'],
 ['review mode',{conversationMode:'review'},'HUMAN_TAKEOVER'],
 ['template pending',{metaTemplateApprovedAndComponentsVerified:false},'META_TEMPLATE_UNVERIFIED'],
] as const){
 Deno.test('Stage3: denied '+name,()=>{
  const result=reviewCommercialAction({...base,...changes} as CommercialEvidence);
  assert(result.code===reason,'Expected '+reason+' got '+result.code);
  assert(!result.eligibleForControlledQueue&&!result.dispatchAuthorized,'Blocked preflight eligible');
 });
}
Deno.test('Stage3: WhatsApp free-form reply requires canonical 24h inbound',()=>{
 const result=reviewCommercialAction({
  ...base,actionType:'whatsapp_reply',canonicalInboundWithin24h:false,
 });
 assert(result.code==='META_WINDOW_CLOSED','Missing canonical window validation');
});
Deno.test('Stage3: email never uses unverified recipient',()=>{
 const result=reviewCommercialAction({...base,actionType:'email',mailRecipientVerified:false});
 assert(result.code==='MAIL_RECIPIENT_UNVERIFIED','Unverified recipient allowed');
});
Deno.test('Stage3: stage changes require canonical stage ID',()=>{
 const result=reviewCommercialAction({
  ...base,actionType:'crm_stage_change',canonicalStageIsAllowed:false,
 });
 assert(result.code==='CANONICAL_STAGE_UNKNOWN','Stage ID may not come from canvas');
});
Deno.test('Stage3: billing action is always read-only',()=>{
 const result=reviewCommercialAction({...base,actionType:'billing_read'});
 assert(result.code==='BILLING_READ_ONLY'&&!result.dispatchAuthorized,'Billing cannot be dispatched');
});
Deno.test('Stage3: undefined/unknown action type is denied',()=>{
 const result=reviewCommercialAction({
  ...base,actionType:'execute_stripe_charge' as CommercialEvidence['actionType'],
 });
 assert(result.code==='INVALID_ACTION'&&!result.eligibleForControlledQueue,'Unknown action allowed');
});

Deno.test('Stage3 CRM worker response is typed as non-emitting',()=>{
 const report:CommercialCrmWorkerReport={
  ok:true,processed:0,unresolved:0,channel:'crm',
  externalMessagesSent:0,paymentsCreated:0,
 };
 assert(report.externalMessagesSent===0&&report.paymentsCreated===0,
  'CRM worker must never emit external effects');
});
