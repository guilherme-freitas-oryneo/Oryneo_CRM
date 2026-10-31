/** WhatsApp template release preflight. This is NOT a sender.
 * Status from an older cached catalog is never send authority.
 */
export type MetaTemplateSnapshot={
 id:string;accountId:string;name:string;language:string;category:string;
 status:string;componentsVerified:boolean;sendGuard:string;variableNumbers:string[];
};
export type MetaTemplateProof={
 accountId:string;id:string;name:string;status:string;language:string;
 componentsVerified:boolean;checkedAtMs:number;source:'meta_api';
};
export type MetaTemplateDecision={
 eligibleForControlledQueue:boolean;dispatchAuthorized:false;
 code:string;templateName:string|null;
};
export function reviewMetaTemplate(input:{
 registry:MetaTemplateSnapshot|null;liveProof:MetaTemplateProof|null;
 actualVariables:Readonly<Record<string,string>>;
 consent:boolean;optedOut:boolean;humanLocked:boolean;nowMs:number;
 simulation?:{assumeApproved?:boolean};
}):MetaTemplateDecision{
 const reject=(code:string):MetaTemplateDecision=>({code,eligibleForControlledQueue:false,
  dispatchAuthorized:false,templateName:input.registry?.name||null});
 const t=input.registry,p=input.liveProof;
 if(!t)return reject('TEMPLATE_NOT_REGISTERED');
 if(!/^[a-z0-9_]{3,90}$/.test(t.name)||!t.id||!t.accountId
   ||t.language!=='pt_BR'||!['MARKETING','UTILITY','AUTHENTICATION'].includes(t.category))
   return reject('TEMPLATE_IDENTITY_INVALID');
 if(t.sendGuard!=='backend_required'||!t.componentsVerified)
   return reject('TEMPLATE_COMPONENTS_UNVERIFIED');
 if(!input.consent||input.optedOut||input.humanLocked)
   return reject('CONTACT_NOT_ELIGIBLE');
 // The simulation flag is intentionally never considered here.
 if(!p||p.source!=='meta_api'||p.checkedAtMs>input.nowMs
   ||input.nowMs-p.checkedAtMs>60_000)
   return reject('LIVE_META_REFRESH_REQUIRED');
 if(p.accountId!==t.accountId||p.id!==t.id||p.name!==t.name
   ||p.language!==t.language)return reject('LIVE_META_IDENTITY_DRIFT');
 if(p.status!=='APPROVED'||t.status!=='APPROVED'
   ||!p.componentsVerified)return reject('LIVE_META_TEMPLATE_UNAVAILABLE');
 const required=new Set(t.variableNumbers);
 if(required.size!==t.variableNumbers.length
   ||t.variableNumbers.some(n=>!/^[1-9][0-9]?$/.test(n))
   ||Object.keys(input.actualVariables).length!==required.size
   ||Object.entries(input.actualVariables).some(([k,v])=>
     !required.has(k)||typeof v!=='string'||!v.trim()||v.length>512))
   return reject('META_PARAMETERS_MISMATCH');
 return {eligibleForControlledQueue:true,dispatchAuthorized:false,
  code:'ELIGIBLE_AFTER_FURTHER_CHANNEL_CHECKS',templateName:t.name};
}
