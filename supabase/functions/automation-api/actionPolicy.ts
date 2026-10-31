/**
 * Deterministic pre-dispatch policy analysis (side-effect free).
 * This only explains why an action must NOT send. Even if all listed gates pass,
 * a separately audited durable adapter and fresh server checks are mandatory.
 */
export type ActionChannel='whatsapp_reply'|'whatsapp_template'|'email'|'crm_stage_change';
export type CanonicalActionContext={
  channel:ActionChannel;
  workspace:{active:boolean;mode:'disabled'|'shadow'|'live';emergencyStop:boolean};
  conversation?:{
    mode:'sdr_active'|'review'|'human_locked'|'resolved';
    optedOut:boolean;consentGranted:boolean;channelEnabled:boolean;
    lastInboundAt:string|null;
  };
  template?:{
    status:string;componentsVerified:boolean;language:string;
    checkedAt:string|null;
  };
  delivery?:{
    state:'unclaimed'|'leased'|'sent'|'uncertain'|'failed'|'dead_letter';
    leaseOwnerVerified:boolean;
  };
  billing?:{
    status:string;verifiedWebhook:boolean;
  };
};
export type PolicyReview={
  canPrepareAction:boolean;
  dispatchAuthorized:false;
  issues:string[];
  checksAt:string;
};
const MS_MIN=60_000;
export function reviewServerAction(
  context:CanonicalActionContext,now=new Date(),
):PolicyReview{
  const issues:string[]=[];
  const add=(code:string)=>{if(!issues.includes(code))issues.push(code);};
  if(!Number.isFinite(now.getTime()))add('SERVER_TIME_INVALID');
  if(!context.workspace.active||context.workspace.mode!=='live'||
    context.workspace.emergencyStop)add('RUNTIME_STOPPED');
  if(!context.delivery||context.delivery.state!=='leased'||
    context.delivery.leaseOwnerVerified!==true)add('ACTION_NOT_OWNED');
  if(context.delivery?.state==='uncertain')add('PROVIDER_RESULT_UNKNOWN');
  if(context.delivery?.state==='sent')add('ALREADY_SENT');

  if(context.channel==='whatsapp_template'||context.channel==='whatsapp_reply'){
    const c=context.conversation;
    if(!c)add('CONVERSATION_REQUIRED');
    else{
      if(!c.channelEnabled)add('CHANNEL_DISABLED');
      if(c.optedOut)add('OPTED_OUT');
      if(!c.consentGranted)add('CONSENT_REQUIRED');
      if(c.mode!=='sdr_active')add('HUMAN_OR_REVIEW_MODE');
      if(context.channel==='whatsapp_reply'){
        const timestamp=c.lastInboundAt?Date.parse(c.lastInboundAt):NaN;
        // Conservative 5m delivery margin; never infer from an old cached event.
        const elapsed=now.getTime()-timestamp;
        if(!Number.isFinite(timestamp)||elapsed<0||elapsed>=24*60*MS_MIN-5*MS_MIN)
          add('WHATSAPP_WINDOW_NOT_VERIFIED');
      }
    }
  }
  if(context.channel==='whatsapp_template'){
    const t=context.template;
    if(!t||t.status!=='APPROVED'||t.language!=='pt_BR'||
      !t.componentsVerified)add('TEMPLATE_NOT_APPROVED_FOR_SEND');
    const seen=t?.checkedAt?Date.parse(t.checkedAt):NaN;
    if(!Number.isFinite(seen)||!Number.isFinite(now.getTime())||
      seen>now.getTime()||now.getTime()-seen>2*MS_MIN)
      add('TEMPLATE_STATUS_STALE');
  }
  if(context.channel==='crm_stage_change'&&context.billing){
    // When a stage change is funded by billing, a browser-supplied status is
    // NEVER enough. A verified canonical webhook is required.
    if(context.billing.status!=='paid'||!context.billing.verifiedWebhook)
      add('PAYMENT_NOT_CANONICALLY_VERIFIED');
  }
  return {
    canPrepareAction:issues.length===0,dispatchAuthorized:false,issues,
    checksAt:Number.isFinite(now.getTime())?now.toISOString():'invalid',
  };
}
