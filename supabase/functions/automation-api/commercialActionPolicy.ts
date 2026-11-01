/**
 * ORYNEO Macroetapa 3: shared provider-independent release policy.
 * This module never sends, charges, mutates CRM or touches the network.
 * A caller MUST independently acquire a database-fenced action lease and
 * prove the legacy executor was disabled before any actual dispatch.
 */
export type CommercialChannel='whatsapp'|'email'|'crm'|'onboarding'|'billing';
export type CommercialAction=
 'whatsapp_template'|'whatsapp_reply'|'email'|'crm_stage_change'|
 'crm_update'|'crm_task'|'human_handoff'|'notify'|'billing_read';
export type CommercialGateCode=
 'CANONICAL_PROOF_REQUIRED'|'EMERGENCY_STOP'|'NOT_LIVE'|
 'LEGACY_EXECUTOR_OWNS_CHANNEL'|'LEASE_FENCE_REQUIRED'|'DRAFT_OR_MUTATED_VERSION'|
 'PROVIDER_UNVERIFIED'|'CONSENT_REQUIRED'|'OPTED_OUT'|'HUMAN_TAKEOVER'|
 'META_TEMPLATE_UNVERIFIED'|'META_WINDOW_CLOSED'|'MAIL_RECIPIENT_UNVERIFIED'|
 'CANONICAL_STAGE_UNKNOWN'|'INVALID_ACTION'|'BILLING_READ_ONLY'|'ELIGIBLE_BUT_NOT_DISPATCHED';
export type CommercialEvidence={
  actionType:CommercialAction;
  workspaceActive:boolean;
  mode:'disabled'|'shadow'|'live';
  emergencyStop:boolean;
  versionPublished:boolean;
  graphNodeTypeMatches:boolean;
  actionLeaseFenced:boolean;
  channelOwner:'legacy'|'new_engine'|'unverified';
  providerConfigured:boolean;
  consentVerified?:boolean;
  optedOut?:boolean;
  conversationMode?:'sdr_active'|'human_locked'|'review'|'resolved';
  canonicalInboundWithin24h?:boolean;
  metaTemplateApprovedAndComponentsVerified?:boolean;
  mailRecipientVerified?:boolean;
  canonicalStageIsAllowed?:boolean;
};
export type CommercialDecision={
  eligibleForControlledQueue:boolean;
  dispatchAuthorized:false;
  code:CommercialGateCode;
  channel:CommercialChannel|null;
};
const CHANNEL:Readonly<Partial<Record<CommercialAction,CommercialChannel>>>={
 whatsapp_template:'whatsapp',whatsapp_reply:'whatsapp',
 email:'email',crm_stage_change:'crm',crm_update:'crm',crm_task:'crm',
 human_handoff:'whatsapp',notify:'crm',billing_read:'billing',
};
export function reviewCommercialAction(e:CommercialEvidence):CommercialDecision{
 const channel=CHANNEL[e.actionType]??null;
 const denied=(code:CommercialGateCode):CommercialDecision=>({
  eligibleForControlledQueue:false,dispatchAuthorized:false,code,channel,
 });
 if(!channel)return denied('INVALID_ACTION');
 // Even a green preflight is never a delivery instruction. The live runtime,
 // provider receipt reconciler and single-owner adapter are separate.
 if(e.actionType==='billing_read')return denied('BILLING_READ_ONLY');
 if(e.emergencyStop)return denied('EMERGENCY_STOP');
 if(!e.workspaceActive||e.mode!=='live')return denied('NOT_LIVE');
 if(!e.versionPublished||!e.graphNodeTypeMatches)
   return denied('DRAFT_OR_MUTATED_VERSION');
 if(!e.actionLeaseFenced)return denied('LEASE_FENCE_REQUIRED');
 if(e.channelOwner!=='new_engine')return denied('LEGACY_EXECUTOR_OWNS_CHANNEL');
 if(!e.providerConfigured)return denied('PROVIDER_UNVERIFIED');
 if(e.actionType==='whatsapp_template'||e.actionType==='whatsapp_reply'){
  if(e.optedOut!==false)return denied('OPTED_OUT');
  if(e.consentVerified!==true)return denied('CONSENT_REQUIRED');
  if(e.conversationMode!=='sdr_active')return denied('HUMAN_TAKEOVER');
  if(e.actionType==='whatsapp_reply'&&e.canonicalInboundWithin24h!==true)
   return denied('META_WINDOW_CLOSED');
  if(e.actionType==='whatsapp_template'&&e.metaTemplateApprovedAndComponentsVerified!==true)
   return denied('META_TEMPLATE_UNVERIFIED');
 }
 if(e.actionType==='email'){
  if(e.mailRecipientVerified!==true)return denied('MAIL_RECIPIENT_UNVERIFIED');
  // A verified address is not proof of consent. Fail closed for unknown
  // consent/opt-out; preflight still cannot authorize delivery.
  if(e.optedOut!==false)return denied('OPTED_OUT');
  if(e.consentVerified!==true)return denied('CONSENT_REQUIRED');
 }
 if(e.actionType==='crm_stage_change'&&e.canonicalStageIsAllowed!==true)
  return denied('CANONICAL_STAGE_UNKNOWN');
 return {
  eligibleForControlledQueue:true,dispatchAuthorized:false,
  code:'ELIGIBLE_BUT_NOT_DISPATCHED',channel,
 };
}
