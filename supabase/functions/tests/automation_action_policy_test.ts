import { reviewServerAction, type CanonicalActionContext } from '../automation-api/actionPolicy.ts';
const at=new Date('2026-10-30T18:00:00.000Z');
const assert=(value:boolean,message:string)=>{if(!value)throw new Error(message)};
const base=():CanonicalActionContext=>({
  channel:'whatsapp_reply',
  workspace:{active:true,mode:'live',emergencyStop:false},
  delivery:{state:'leased',leaseOwnerVerified:true},
  conversation:{mode:'sdr_active',optedOut:false,consentGranted:true,
    channelEnabled:true,lastInboundAt:'2026-10-30T17:00:00.000Z'},
});
const review=(x:CanonicalActionContext)=>reviewServerAction(x,at);
Deno.test('policy preflight never grants external dispatch, even with eligible context',()=>{
 const result=review(base());
 assert(result.canPrepareAction,'safe candidate must be individually checked');
 assert(result.dispatchAuthorized===false,'preflight is not dispatch authorization');
});
Deno.test('24-hour free reply window expiration fails closed',()=>{
 const x=base();x.conversation!.lastInboundAt='2026-10-29T17:00:00.000Z';
 assert(review(x).issues.includes('WHATSAPP_WINDOW_NOT_VERIFIED'),'stale response window allowed');
 x.conversation!.lastInboundAt='not-a-date';
 assert(review(x).issues.includes('WHATSAPP_WINDOW_NOT_VERIFIED'),'invalid date allowed');
});
Deno.test('human takeover, review, opt-out and consent block messaging',()=>{
 const x=base();x.conversation!.mode='human_locked';
 assert(review(x).issues.includes('HUMAN_OR_REVIEW_MODE'),'human operator overridden');
 x.conversation!.mode='review';
 assert(review(x).issues.includes('HUMAN_OR_REVIEW_MODE'),'review overridden');
 x.conversation!.mode='sdr_active';x.conversation!.optedOut=true;
 assert(review(x).issues.includes('OPTED_OUT'),'opt out ignored');
 x.conversation!.optedOut=false;x.conversation!.consentGranted=false;
 assert(review(x).issues.includes('CONSENT_REQUIRED'),'missing consent ignored');
});
Deno.test('paused or unverified template blocks even within an active conversation',()=>{
 const x=base();x.channel='whatsapp_template';
 x.template={status:'APPROVED',componentsVerified:true,language:'pt_BR',
   checkedAt:'2026-10-30T17:59:00.000Z'};
 assert(review(x).canPrepareAction,'recent approved template should be preflight eligible');
 x.template.status='PAUSED';
 assert(review(x).issues.includes('TEMPLATE_NOT_APPROVED_FOR_SEND'),'paused template allowed');
 x.template.status='APPROVED';x.template.checkedAt='2026-10-30T17:50:00.000Z';
 assert(review(x).issues.includes('TEMPLATE_STATUS_STALE'),'old approval snapshot used');
});
Deno.test('no worker lease, uncertain provider result or already sent requires reconciliation',()=>{
 const x=base();x.delivery={state:'uncertain',leaseOwnerVerified:false};
 const a=review(x);
 assert(a.issues.includes('ACTION_NOT_OWNED')&&a.issues.includes('PROVIDER_RESULT_UNKNOWN'),
   'uncertain provider outcome treated as safe');
 x.delivery={state:'sent',leaseOwnerVerified:false};
 assert(review(x).issues.includes('ALREADY_SENT'),'duplicate external effect allowed');
});
Deno.test('financial stage change cannot trust a customer claim',()=>{
 const x=base();x.channel='crm_stage_change';delete x.conversation;
 x.stage={targetId:'11111111-1111-4111-8111-111111111111',targetVerified:true,outcome:'won'};
 assert(review(x).issues.includes('PAYMENT_NOT_CANONICALLY_VERIFIED'),
   'absent billing context bypassed paid stage gate');
 x.billing={status:'paid',verifiedWebhook:false};
 assert(review(x).issues.includes('PAYMENT_NOT_CANONICALLY_VERIFIED'),
   'unverified paid claim advanced stage');
 x.billing={status:'paid',verifiedWebhook:true};
 assert(review(x).canPrepareAction,'confirmed webhook should pass preflight');
 assert(!review(x).dispatchAuthorized,'must not mutate CRM from preflight');
});
Deno.test('runtime emergency stop takes precedence over all provider success',()=>{
 const x=base();x.workspace.emergencyStop=true;
 assert(review(x).issues.includes('RUNTIME_STOPPED'),'emergency stop ignored');
 x.workspace.emergencyStop=false;x.workspace.mode='shadow';
 assert(review(x).issues.includes('RUNTIME_STOPPED'),'shadow mode sent a message');
});

Deno.test('automation never changes to an unverified or unreviewed loss stage',()=>{
 const x=base();x.channel='crm_stage_change';
 x.stage={targetId:'22222222-2222-4222-8222-222222222222',
   targetVerified:false,outcome:'open'};
 assert(review(x).issues.includes('STAGE_NOT_CANONICALLY_VERIFIED'),
   'untrusted stage was accepted');
 x.stage.targetVerified=true;x.stage.outcome='lost';
 assert(review(x).issues.includes('HUMAN_APPROVAL_FOR_LOSS_REQUIRED'),
   'automation silently marked deal lost');
 x.stage.outcome='open';
 assert(review(x).canPrepareAction,'canonical open stage should pass policy preflight');
});
Deno.test('email requires verified recipient, approved template and explicit consent',()=>{
 const x=base();x.channel='email';delete x.conversation;
 assert(review(x).issues.includes('EMAIL_RECIPIENT_UNVERIFIED'),'unknown recipient silently accepted');
 assert(review(x).issues.includes('EMAIL_TEMPLATE_NOT_APPROVED'),'missing email template allowed');
 assert(review(x).issues.includes('EMAIL_CONSENT_OR_OPTOUT'),'missing consent ignored');
 x.email={verifiedRecipient:true,templateApproved:true,
   consentGranted:true,optedOut:false,sourceVerified:true};
 assert(review(x).canPrepareAction,'verified email context should pass preflight');
 x.email.optedOut=true;
 assert(review(x).issues.includes('EMAIL_CONSENT_OR_OPTOUT'),'email opt out ignored');
 assert(review(x).dispatchAuthorized===false,'email policy never authorizes send');
});
