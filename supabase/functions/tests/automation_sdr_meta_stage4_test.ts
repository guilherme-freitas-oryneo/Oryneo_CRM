import {reviewMetaTemplate} from '../_shared/sdr/metaTemplatePolicy.ts';
const t={
 id:'1092708390305626',accountId:'28794700556857948',
 name:'oryneo_conversar_sem_plano_v3',language:'pt_BR',
 category:'MARKETING',status:'APPROVED',componentsVerified:true,
 sendGuard:'backend_required',variableNumbers:['1','2'],
};
const now=1782930000000;
const p={id:t.id,accountId:t.accountId,name:t.name,language:t.language,
 status:'APPROVED',componentsVerified:true,checkedAtMs:now,source:'meta_api' as const};
const args={registry:t,liveProof:p,actualVariables:{'1':'Maria','2':'Growth'},
 consent:true,optedOut:false,humanLocked:false,nowMs:now};
const assert=(v:unknown,message:string)=>{if(!v)throw Error(message);};
Deno.test('B02/E12/C02: approved registry alone never allows sending without live Meta proof',()=>{
 for(const liveProof of [null,{...p,status:'PAUSED'},{...p,status:'PENDING'},
  {...p,status:'REJECTED'},{...p,checkedAtMs:now-60001},
  {...p,accountId:'different'},{...p,componentsVerified:false}]){
  const result=reviewMetaTemplate({...args,liveProof,
   simulation:{assumeApproved:true}});
  assert(!result.eligibleForControlledQueue&&!result.dispatchAuthorized,
   'Stale/suspended/ambiguous template passed delivery preflight');
 }
});
Deno.test('E11: UI simulate assume approved does not bypass actual Meta proof',()=>{
 const blocked=reviewMetaTemplate({...args,liveProof:null,simulation:{assumeApproved:true}});
 assert(blocked.code==='LIVE_META_REFRESH_REQUIRED','Simulator flag escaped production boundary');
});
Deno.test('C01/C02: consent, opt-out and human takeover always win',()=>{
 for(const changes of [{consent:false},{optedOut:true},{humanLocked:true}]){
  const blocked=reviewMetaTemplate({...args,...changes});
  assert(!blocked.eligibleForControlledQueue,'Blocked contact eligible for template');
 }
});
Deno.test('C02: official approved template needs matching ID, language, verified components and parameters',()=>{
 const ok=reviewMetaTemplate(args);
 assert(ok.eligibleForControlledQueue&&ok.dispatchAuthorized===false,'Safe result unexpected');
 for(const changes of [
  {actualVariables:{'1':'Maria'}},
  {actualVariables:{'1':'Maria','2':'Growth','3':'unexpected'}},
  {actualVariables:{'1':'Maria','2':''}},
  {registry:{...t,componentsVerified:false}},
  {registry:{...t,variableNumbers:['1','1']}},
  {registry:{...t,status:'PAUSED'}},
 ]){
  const invalid=reviewMetaTemplate({...args,...changes} as Parameters<typeof reviewMetaTemplate>[0]);
  assert(!invalid.eligibleForControlledQueue,'Provider identity/variables failure was allowed');
 }
});
