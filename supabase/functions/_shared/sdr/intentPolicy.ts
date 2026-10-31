/** ORYNEO SDR intent policy — pure and deterministic.
 * A lexical hint is NOT a legal/financial decision or authorization to send.
 * No model calls, CRM mutations, provider messaging, or arbitrary regex input.
 */
export type IntentEntry={
 id:string; label:string; positive:string[];negative:string[];
 synonyms:string[];risk:'normal'|'human_review';
};
export type IntentDictionary={releaseVersion:number;language:'pt_BR';entries:IntentEntry[]};
export type IntentDecision={
 intent:string|null;confidence:number;ambiguous:boolean;kind:'request'|'question'|'negated'|'third_party'|'unknown';
 evidence:string;humanReview:boolean;alternatives:string[];dispatchAuthorized:false;
};
export const NORMALIZE=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
const contains=(haystack:string,phrase:string)=>(' '+haystack+' ').includes(' '+phrase+' ');
const UNSAFE_WORDS=/\b(ignore|ignorar|desconsiderar|substitua|override|senha|token|system prompt|regras internas)\b/;
const NEGATORS=new Set(['nao','nunca','jamais','nem','sem']);
const thirdParty=new Set(['concorrente','outra','outras','terceiro','fornecedor','amigo','colega']);
const question=new Set(['posso','pode','tem','como','quando','qual','quais','quanto','existe','e','seria']);
const highRiskTerms=['carencia','multa','rescisao','cancelamento','cancelar','reembolso','garantia','prazo de implantacao','ja paguei','pagamento confirmado','dinheiro caiu','valor da multa','fidelidade'];
const shortlist=(s:string)=>s.slice(0,160);
export function validateIntentDictionary(x:unknown):x is IntentDictionary{
 if(!x||typeof x!=='object'||Array.isArray(x))return false;
 const d=x as IntentDictionary;
 if(!Number.isSafeInteger(d.releaseVersion)||d.releaseVersion<1||d.language!=='pt_BR'
   ||!Array.isArray(d.entries)||d.entries.length<10||d.entries.length>40)return false;
 const ids=new Set<string>();
 for(const e of d.entries){
  if(!e||typeof e!=='object'||Object.keys(e).some(key=>!['id','label','positive','negative','synonyms','risk'].includes(key))||typeof e.id!=='string'
    ||!/^[a-z][a-z0-9_]{1,40}$/.test(e.id)||ids.has(e.id)
    ||typeof e.label!=='string'||e.label.length>75||e.label.length<2
    ||!['normal','human_review'].includes(e.risk)
    ||!Array.isArray(e.positive)||e.positive.length<2||e.positive.length>20
    ||!Array.isArray(e.negative)||e.negative.length<1||e.negative.length>20
    ||!Array.isArray(e.synonyms)||e.synonyms.length<1||e.synonyms.length>20
    ||![...e.positive,...e.negative,...e.synonyms].every(s=>typeof s==='string'
      &&s.trim().length>=2&&s.length<=160
      &&!UNSAFE_WORDS.test(NORMALIZE(s))))return false;
  ids.add(e.id);
 }
 return true;
}
function contextKind(s:string,term:string):IntentDecision['kind']{
 const parts=s.split(' ');
 const phrase=term.split(' ');
 const ix=parts.findIndex((_,i)=>phrase.every((word,j)=>parts[i+j]===word));
 const before=ix<0?[]:parts.slice(Math.max(0,ix-4),ix);
 if(before.some(x=>NEGATORS.has(x)))return 'negated';
 if(parts.slice(0,8).some(x=>thirdParty.has(x)))return 'third_party';
 if(parts.slice(0,5).some(x=>question.has(x))||s.startsWith('queria saber')||s.startsWith('gostaria de saber'))return 'question';
 return 'request';
}
export function classifySdrIntent(text:string,dictionary:IntentDictionary):IntentDecision{
 const denied=(kind:IntentDecision['kind']='unknown',evidence=''):IntentDecision=>({
  intent:null,confidence:0,ambiguous:true,kind,evidence,alternatives:[],
  humanReview:false,dispatchAuthorized:false,
 });
 if(!validateIntentDictionary(dictionary)||typeof text!=='string'
   ||!text.trim()||text.length>8000)return denied();
 const normalized=NORMALIZE(text);
 if(!normalized)return denied();
 const candidates: {id:string;score:number;term:string;kind:IntentDecision['kind'];risk:IntentEntry['risk']}[]=[];
 for(const e of dictionary.entries){
  // Explicit negative examples outrank the positive lexicon.
  if(e.negative.some(example=>contains(normalized,NORMALIZE(example))))continue;
  const patterns=[
   ...e.positive.map(s=>({s,weight:3})),
   ...e.synonyms.map(s=>({s,weight:2})),
  ].filter(x=>NORMALIZE(x.s).length>=2&&contains(normalized,NORMALIZE(x.s)));
  if(!patterns.length)continue;
  patterns.sort((a,b)=>b.weight-a.weight||b.s.length-a.s.length);
  const winner=patterns[0];
  const term=NORMALIZE(winner.s);
  candidates.push({id:e.id,score:winner.weight,term,kind:contextKind(normalized,term),risk:e.risk});
 }
 if(!candidates.length){
  const matched=highRiskTerms.find(w=>contains(normalized,w));
  if(!matched)return denied();
  const kind=contextKind(normalized,matched);
  return {...denied(kind,shortlist(normalized)),
    humanReview:kind!=='negated'&&kind!=='third_party'};
 }
 candidates.sort((a,b)=>b.score-a.score||b.term.length-a.term.length);
 const best=candidates[0],other=candidates.filter(c=>c.id!==best.id&&c.score>=best.score);
 const ambiguous=other.length>0||best.kind==='negated'||best.kind==='third_party';
 const risk=best.risk==='human_review'||highRiskTerms.some(w=>contains(normalized,w));
 return {intent:ambiguous?null:best.id,confidence:ambiguous?0.25:best.score===3?0.93:0.78,
   ambiguous,kind:best.kind,evidence:shortlist(best.term),
   humanReview:risk&&! (best.kind==='negated'||best.kind==='third_party'),
   alternatives:other.slice(0,3).map(x=>x.id),dispatchAuthorized:false};
}
