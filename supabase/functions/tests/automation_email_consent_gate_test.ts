import {reviewCommercialAction,type CommercialEvidence} from '../automation-api/commercialActionPolicy.ts';

const base:CommercialEvidence={
 actionType:'email',workspaceActive:true,mode:'live',emergencyStop:false,
 versionPublished:true,graphNodeTypeMatches:true,actionLeaseFenced:true,
 channelOwner:'new_engine',providerConfigured:true,
 mailRecipientVerified:true,consentVerified:true,optedOut:false,
};
const denied=(input:Partial<CommercialEvidence>,expected:string)=>{
 const result=reviewCommercialAction({...base,...input});
 if(result.code!==expected||result.eligibleForControlledQueue||result.dispatchAuthorized!==false)
  throw Error('EMAIL_POLICY_NOT_FAIL_CLOSED: '+expected+' got '+result.code);
};
Deno.test('ORYNEO e-mail policy: verified recipient without consent must be blocked',()=>{
 denied({consentVerified:false},'CONSENT_REQUIRED');
 denied({consentVerified:undefined},'CONSENT_REQUIRED');
});
Deno.test('ORYNEO e-mail policy: unknown or positive opt-out must be blocked',()=>{
 denied({optedOut:true},'OPTED_OUT');
 denied({optedOut:undefined},'OPTED_OUT');
});
Deno.test('ORYNEO e-mail policy: unverified recipient stays blocked first',()=>{
 denied({mailRecipientVerified:false},'MAIL_RECIPIENT_UNVERIFIED');
});
Deno.test('ORYNEO e-mail policy: all checks never authorize a send',()=>{
 const result=reviewCommercialAction(base);
 if(result.code!=='ELIGIBLE_BUT_NOT_DISPATCHED'
  ||result.dispatchAuthorized!==false||!result.eligibleForControlledQueue)
   throw Error('EMAIL_PREFLIGHT_MUST_NOT_DISPATCH');
});
Deno.test('ORYNEO e-mail policy: legacy owner and kill switch are respected',()=>{
 denied({channelOwner:'legacy'},'LEGACY_EXECUTOR_OWNS_CHANNEL');
 denied({emergencyStop:true},'EMERGENCY_STOP');
});
