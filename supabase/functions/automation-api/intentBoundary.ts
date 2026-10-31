/**
 * Canonical intent-classification boundary. The model's output is untrusted:
 * never accept its action, tool, instructions, quoted links or business claims.
 * Only a published/approved versioned dictionary maps an intent to a
 * reviewed policy. The result NEVER authorizes any side effect.
 */
type Obj=Record<string,unknown>;
const obj=(x:unknown):x is Obj=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const str=(x:unknown,max:number):x is string=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID=/^[a-z][a-z0-9_]{2,63}$/;
const SHA=/^[0-9a-f]{64}$/i;
const ACTIONS=new Set([
 'knowledge_lookup_or_handoff',
 'verify_canonical_billing_only',
 'handoff_rule',
 'lookup_catalog_and_validate_bundle',
 'review_required',
]);
const TEXT=/[\p{L}\p{N}]/u;
const norm=(text:string)=>text.normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
type Example={id:string;action:string;positive:string[];negative:string[]};
export type PublishedIntentDictionary={
  status:'published';language:'pt_BR';approved_by:string;
  content_sha256:string;examples:Example[];
  synonyms:Array<{id:string;negative:string[];terms?:string[]}>;
};
export type IntentReview={
  accepted:boolean;needsHumanReview:boolean;dispatchAuthorized:false;
  intentId?:string;action?:string;confidence?:number;
  reasons:string[];
};

/** Reject malformed dictionaries before ever exposing them to a model. */
export function validatePublishedDictionary(raw:unknown):{
  valid:boolean;issues:string[];dictionary:PublishedIntentDictionary|null;
}{
  const issues:string[]=[];const add=(reason:string)=>{if(!issues.includes(reason))issues.push(reason)};
  if(!obj(raw)||raw.status!=='published'||raw.language!=='pt_BR'
    ||!str(raw.approved_by,36)||!UUID.test(raw.approved_by)
    ||!str(raw.content_sha256,64)||!SHA.test(raw.content_sha256)){
    add('DICTIONARY_RELEASE_NOT_APPROVED');
    return {valid:false,issues,dictionary:null};
  }
  if(!Array.isArray(raw.examples)||raw.examples.length===0||raw.examples.length>64
     ||!Array.isArray(raw.synonyms)||raw.synonyms.length>64){
    add('DICTIONARY_STRUCTURE_INVALID');
    return {valid:false,issues,dictionary:null};
  }
  const ids=new Set<string>();const positive=new Set<string>();const parsed:Example[]=[];
  for(const row of raw.examples){
    if(!obj(row)||!str(row.id,64)||!ID.test(row.id)
       ||!str(row.action,64)||!ACTIONS.has(row.action)
       ||!Array.isArray(row.positive)||!Array.isArray(row.negative)
       ||row.positive.length<1||row.positive.length>32||row.negative.length<1
       ||row.negative.length>32||[...row.positive,...row.negative]
         .some(x=>!str(x,240)||!TEXT.test(x))){
       add('DICTIONARY_ENTRY_INVALID');continue;
    }
    if(ids.has(row.id))add('DICTIONARY_INTENT_DUPLICATE');
    ids.add(row.id);
    const positives=row.positive as string[],negatives=row.negative as string[];
    const negativesNormalized=new Set(negatives.map(norm));
    for(const ex of positives){
      const canonical=norm(ex);
      if(positive.has(canonical)||negativesNormalized.has(canonical))
        add('DICTIONARY_TRAINING_EXAMPLE_CONFLICT');
      positive.add(canonical);
    }
    parsed.push({id:row.id,action:row.action,positive:positives,negative:negatives});
  }
  const synonymIds=new Set<string>();
  for(const row of raw.synonyms){
    if(!obj(row)||!str(row.id,64)||!ID.test(row.id)
       ||!ids.has(row.id)||synonymIds.has(row.id)
       ||!Array.isArray(row.negative)||row.negative.length>32
       ||row.negative.some(x=>!str(x,240))
       ||(row.terms!==undefined&&
         (!Array.isArray(row.terms)||row.terms.length>32
         ||row.terms.some(x=>!str(x,80))))){
      add('DICTIONARY_SYNONYM_INVALID');continue;
    }
    synonymIds.add(row.id);
  }
  if(issues.length)return {valid:false,issues,dictionary:null};
  return {valid:true,issues:[],dictionary:raw as unknown as PublishedIntentDictionary};
}

/**
 * Model-generated labels cannot bypass negative examples, opt-out policy,
 * missing evidence, or the configured confidence. Model-provided actions,
 * reason text and provider URLs are ignored/rejected.
 */
export function assessIntentCandidate(args:{
  dictionary:unknown;message:unknown;candidate:unknown;minConfidence?:number;
}):IntentReview{
  const issues:string[]=[];const fail=(code:string)=>{if(!issues.includes(code))issues.push(code)};
  const approved=validatePublishedDictionary(args.dictionary);
  if(!approved.valid||!approved.dictionary)
    return {accepted:false,needsHumanReview:true,dispatchAuthorized:false,
      reasons:['DICTIONARY_RELEASE_NOT_APPROVED',...approved.issues.filter(x=>x!=='DICTIONARY_RELEASE_NOT_APPROVED')]};
  if(!str(args.message,2000))
    return {accepted:false,needsHumanReview:true,dispatchAuthorized:false,
      reasons:['MESSAGE_NOT_VERIFIED']};
  if(!obj(args.candidate)||Object.keys(args.candidate).some(k=>!
      ['intent','confidence','evidence','uncertain'].includes(k))){
    return {accepted:false,needsHumanReview:true,dispatchAuthorized:false,
      reasons:['INTENT_RESULT_INVALID']};
  }
  const predicted=args.candidate;
  const threshold=Number.isFinite(args.minConfidence)
    ?Number(args.minConfidence):0.85;
  if(threshold<0.5||threshold>0.99)fail('CONFIDENCE_THRESHOLD_INVALID');
  if(!str(predicted.intent,64)||!ID.test(predicted.intent))
    fail('INTENT_UNKNOWN');
  const known=approved.dictionary.examples.find(e=>e.id===predicted.intent);
  if(!known)fail('INTENT_UNKNOWN');
  if(typeof predicted.confidence!=='number'
    ||!Number.isFinite(predicted.confidence)
    ||predicted.confidence<0||predicted.confidence>1)
    fail('CONFIDENCE_INVALID');
  else if(predicted.confidence<threshold)
    fail('INTENT_LOW_CONFIDENCE');
  if(predicted.uncertain!==false)fail('INTENT_UNCERTAIN');
  const utterance=norm(args.message);
  if(!str(predicted.evidence,160)
    ||!utterance.includes(norm(predicted.evidence)))
    fail('EVIDENCE_NOT_IN_MESSAGE');
  if(known){
    const negatives=[
      ...known.negative,
      ...(approved.dictionary.synonyms.find(s=>s.id===known.id)?.negative||[]),
    ];
    if(negatives.some(n=>norm(n)===utterance))
      fail('NEGATIVE_EXAMPLE_MATCH');
    // Conservative semantic guard: negated action declarations require review,
    // not a substring-based assertion that the lead requested cancellation.
    if(known.id==='contract_cancellation_question'
      &&/\b(?:nao|nunca|nem)\s+(?:(?:quero|vou|pretendo|desejo|preciso|posso)\s+)?cancelar\b/.test(utterance))
      fail('NEGATED_INTENT_REQUIRES_REVIEW');
    if(known.id==='human_request'&&
       /\b(?:nao|nunca)\s+(?:quero|preciso|desejo)\s+(?:um\s+)?(?:humano|atendente|pessoa)\b/.test(utterance))
      fail('NEGATED_INTENT_REQUIRES_REVIEW');
  }
  if(issues.length)return {accepted:false,needsHumanReview:true,
    dispatchAuthorized:false,reasons:issues};
  return {accepted:true,needsHumanReview:false,dispatchAuthorized:false,
    intentId:known!.id,action:known!.action,confidence:predicted.confidence as number,reasons:[]};
}
