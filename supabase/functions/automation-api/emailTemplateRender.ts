/** Strict text-only renderer for already approved automation e-mail content. */
export type ApprovedEmailContext={contactName:string;company:string};

export function renderApprovedEmailText(
 template:string,context:ApprovedEmailContext,
):string{
 if(typeof template!=='string'||template.length<1||template.length>20000
   ||/[\0]/.test(template))throw Error('EMAIL_TEMPLATE_INVALID');
 const values:Record<string,string>={
  contact_name:context.contactName,
  company:context.company,
 };
 const rendered=template.replace(/\{\{([a-z_]+)\}\}/g,(_match,key:string)=>{
  const value=values[key];
  if(typeof value!=='string'||!value.trim()||value.length>160||/[\r\n\0]/.test(value))
   throw Error('EMAIL_TEMPLATE_VALUE_INVALID');
  return value.trim();
 });
 if(/\{\{[^}]*\}\}/.test(rendered))throw Error('EMAIL_TEMPLATE_VARIABLE_INVALID');
 return rendered;
}
