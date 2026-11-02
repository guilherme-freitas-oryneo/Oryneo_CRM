/**
 * Meta Cloud API template request: pure construction only, never dispatches.
 * A caller must independently verify fresh approval, consent, exclusive
 * ownership, fencing token and immutable published flow before POST.
 */
export type MetaTemplateRequest={
 messaging_product:'whatsapp';to:string;type:'template';
 template:{name:string;language:{code:'pt_BR'};
 components?:[{type:'body';parameters:Array<{type:'text';text:string}>}]};
};
const allowedName=/^[a-z][a-z0-9_]{2,120}$/;
export function buildMetaTemplateRequest(input:{
 recipient:string;name:string;locale:string;
 values:readonly string[];expectedCount:number;
}):MetaTemplateRequest{
 if(!/^[0-9]{8,32}$/.test(input.recipient))
  throw Error('META_RECIPIENT_INVALID');
 if(!allowedName.test(input.name)||input.locale!=='pt_BR')
  throw Error('META_TEMPLATE_IDENTITY_INVALID');
 if(!Number.isInteger(input.expectedCount)||input.expectedCount<0
  ||input.expectedCount>20||input.values.length!==input.expectedCount)
  throw Error('META_VARIABLE_COUNT_MISMATCH');
 if(input.values.some(v=>typeof v!=='string'||!v.trim()||v.length>160
  ||v.includes(String.fromCharCode(10))||v.includes(String.fromCharCode(13))))
  throw Error('META_PARAMETER_UNVERIFIED');
 const template:MetaTemplateRequest['template']={
  name:input.name,language:{code:'pt_BR'},
 };
 if(input.expectedCount>0)template.components=[{
  type:'body',parameters:input.values.map(v=>({type:'text',text:v.trim()})),
 }];
 return {
  messaging_product:'whatsapp',to:input.recipient,type:'template',
  template,
 };
}
