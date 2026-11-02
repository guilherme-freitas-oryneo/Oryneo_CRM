// ORYNEO typed Meta bindings. No provider calls or implicit values.
export const canonicalTemplateFields = [
  'conversation.customer_name',
  'opportunity.title',
  'opportunity.source',
  'opportunity.plan',
  'opportunity.cycle',
  'opportunity.next_action.title','opportunity.priority',
    'meeting.date','meeting.time','meeting.format',
  'billing.company',
] as const;
const allowed = new Set<string>(canonicalTemplateFields);
export type TemplateReview = {ok:boolean;issues:string[]};
export function validateTemplateBindings(
  bindings: unknown, expected: readonly string[],
): TemplateReview {
  if(!Array.isArray(expected) || expected.length>20
    || expected.some(x=>typeof x!=='string'||!/^[1-9][0-9]?$/.test(x))
    || new Set(expected).size!==expected.length)
    return {ok:false,issues:['META_VARIABLES_UNVERIFIED']};
  if(!bindings||typeof bindings!=='object'||Array.isArray(bindings))
    return {ok:expected.length===0,issues:expected.length?['MAPPING_REQUIRED']:[]};
  const b=bindings as Record<string,unknown>;
  const keys=Object.keys(b);
  const issues:string[]=[];
  if(keys.length!==expected.length||keys.some(x=>!expected.includes(x)))
    issues.push('VARIABLE_INDEX_MISMATCH');
  if(Object.values(b).some(v=>typeof v!=='string'||!allowed.has(v)))
    issues.push('CANONICAL_FIELD_NOT_APPROVED');
  return {ok:issues.length===0,issues};
}
export function resolveTemplateBindings(
  bindings: unknown, expected: readonly string[], canonical: Record<string,unknown>,
): {ok:true;values:string[]}|{ok:false;code:string}{
  const result=validateTemplateBindings(bindings,expected);
  if(!result.ok)return {ok:false,code:result.issues[0]};
  if(expected.length===0)return {ok:true,values:[]};
  if(!bindings||typeof bindings!=='object'||Array.isArray(bindings))
    return {ok:false,code:'BINDINGS_REQUIRED'};
  const b=bindings as Record<string,string>;
  const values:string[]=[];
  for(const key of expected){
    const parts=b[key].split('.');
    let value:unknown=canonical;
    for(const part of parts){
      if(!value||typeof value!=='object'||Array.isArray(value)
        ||!Object.prototype.hasOwnProperty.call(value,part)){
        value=null;break;
      }
      value=(value as Record<string,unknown>)[part];
    }
    if(typeof value!=='string'||!value.trim()||value.length>160
      ||value.includes(String.fromCharCode(10))||value.includes(String.fromCharCode(13)))
      return {ok:false,code:'CANONICAL_VALUE_MISSING'};
    values.push(value.trim());
  }
  return {ok:true,values};
}
