/**
 * Compare a FRESH Meta Graph template detail with immutable registry identity.
 * A stale local APPROVED flag is never sufficient for a new delivery.
 */
type Row=Record<string,unknown>;
const obj=(x:unknown):x is Row=>!!x&&typeof x==='object'&&!Array.isArray(x);
export type TemplateProof={
 id:string;name:string;language:'pt_BR';category:'UTILITY'|'MARKETING';
 variable_numbers:readonly string[];
};
export function inspectFreshMetaApproval(
 response:unknown,expected:TemplateProof,
):{approved:true;body:string}|{approved:false;code:string}{
 if(!obj(response)||String(response.id)!==expected.id
  ||response.name!==expected.name||response.language!==expected.language
  ||response.status!=='APPROVED'||response.category!==expected.category)
  return {approved:false,code:'META_CURRENT_APPROVAL_MISMATCH'};
 if(!Array.isArray(response.components)||response.components.length!==1
  ||!obj(response.components[0])||response.components[0].type!=='BODY'
  ||typeof response.components[0].text!=='string')
  return {approved:false,code:'META_UNSUPPORTED_TEMPLATE_COMPONENTS'};
 const body=response.components[0].text as string;
 if(body.length>4096)
  return {approved:false,code:'META_TEMPLATE_TOO_LARGE'};
 const ordered=[...body.matchAll(/\{\{([1-9][0-9]?)\}\}/g)].map(x=>x[1]);
 const expectedKeys=[...expected.variable_numbers];
 if(ordered.length!==expectedKeys.length||ordered.some((n,i)=>n!==expectedKeys[i]))
  return {approved:false,code:'META_TEMPLATE_PLACEHOLDERS_CHANGED'};
 return {approved:true,body};
}
export function renderVerifiedMetaTemplate(
 body:string,keys:readonly string[],values:readonly string[],
):string{
 if(keys.length!==values.length||keys.length>20||!body)
  throw Error('META_RENDER_ARGUMENTS_INVALID');
 const mapping=new Map<string,string>();
 keys.forEach((k,i)=>mapping.set(k,values[i]));
 const output=body.replace(/\{\{([1-9][0-9]?)\}\}/g,(_m,index:string)=>{
  const value=mapping.get(index);
  if(value===undefined)throw Error('META_RENDER_BINDING_MISSING');
  return value;
 });
 if(output.length>4096)throw Error('META_RENDERED_MESSAGE_TOO_LARGE');
 return output;
}
