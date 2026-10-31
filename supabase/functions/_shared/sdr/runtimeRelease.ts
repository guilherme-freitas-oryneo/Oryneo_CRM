/** Versioned SDR release adapter for service-role worker.
 * Any missing or incompatible published source fails closed to human review.
 */
import {buildSdrKnowledgeContext,isApprovedDictionary,isApprovedSdrRelease,
 type SdrDictionaryRecord,type SdrReleaseRecord} from './knowledgePolicy.ts';
import {validateIntentDictionary,type IntentDictionary} from './intentPolicy.ts';
export type SdrRuntimeSources={
 knowledge:SdrReleaseRecord|null; dictionary:SdrDictionaryRecord|null;
 active:{enabled:boolean;knowledge_release_id:string;dictionary_release_id:string}|null;
};
export type SdrSafeContext={
 training:string;humanReview:boolean;code:string;intent:string|null;
 knowledgeVersion:number|null;dictionaryVersion:number|null;
 dispatchAuthorized:false;
};
/** Stable SHA input across PostgreSQL JSONB and JavaScript object key ordering. */
export function canonicalJson(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonicalJson).join(',')+']';
 if(value&&typeof value==='object'){
  const keys=Object.keys(value as Record<string,unknown>).sort();
  return '{'+keys.filter(k=>(value as Record<string,unknown>)[k]!==undefined)
   .map(k=>JSON.stringify(k)+':'+canonicalJson((value as Record<string,unknown>)[k])).join(',')+'}';
 }
 return JSON.stringify(value);
}
export async function dictionaryDigest(dictionary:IntentDictionary):Promise<string>{
 const raw=canonicalJson({format:'oryneo-intents-v1',release_version:dictionary.releaseVersion,
  language:dictionary.language,entries:dictionary.entries});
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),
  x=>x.toString(16).padStart(2,'0')).join('');
}
export async function verifyDictionaryDigest(
 release:SdrDictionaryRecord|null,entries:IntentDictionary|null,
):Promise<boolean>{
 if(!isApprovedDictionary(release,entries))return false;
 const hash=await dictionaryDigest(entries!);
 return hash===release!.content_sha256;
}
export function readDictionaryPayload(r:SdrDictionaryRecord|null):IntentDictionary|null{
 if(!r||r.language!=='pt_BR'||!Array.isArray(r.examples))return null;
 const d={releaseVersion:r.release_version,language:'pt_BR' as const,entries:r.examples};
 return validateIntentDictionary(d)?d:null;
}
export async function resolveSdrRuntimeTraining(input:{
 sources:SdrRuntimeSources;latestUserMessage:string;conversationMode:string;
 consent:boolean;optedOut:boolean;canonicalPaymentVerified:boolean;
 selection?:{plan?:string;cycle?:string;addons?:string[]};
}):Promise<SdrSafeContext>{
 const reject=(code:string):SdrSafeContext=>({training:'',humanReview:true,
  code,intent:null,knowledgeVersion:null,dictionaryVersion:null,
  dispatchAuthorized:false});
 const {knowledge,dictionary,active}=input.sources;
 if(!active?.enabled||!knowledge||!dictionary||
  active.knowledge_release_id!==knowledge.id||
  active.dictionary_release_id!==dictionary.id||
  !isApprovedSdrRelease(knowledge))return reject('SDR_RELEASE_NOT_ENABLED');
 const entries=readDictionaryPayload(dictionary);
 if(!await verifyDictionaryDigest(dictionary,entries))
  return reject('SDR_INTENT_RELEASE_MISMATCH');
 const decision=buildSdrKnowledgeContext({
  release:{knowledge,dictionary,entries},latestUserMessage:input.latestUserMessage,
  conversationMode:input.conversationMode,consent:input.consent,
  optedOut:input.optedOut,canonicalPaymentVerified:input.canonicalPaymentVerified,
  selection:input.selection,
 });
 return {training:decision.training,humanReview:decision.humanReview||!decision.allowed,
  code:decision.code,intent:decision.intent.intent,
  knowledgeVersion:decision.knowledgeVersion,dictionaryVersion:decision.dictionaryVersion,
  dispatchAuthorized:false};
}
