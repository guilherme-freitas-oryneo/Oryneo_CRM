import {renderApprovedEmailText} from '../automation-api/emailTemplateRender.ts';

const expect=(value:boolean,message:string)=>{if(!value)throw new Error(message);};

Deno.test('renders only the bounded canonical email variables',()=>{
 const rendered=renderApprovedEmailText('Olá, {{contact_name}} — {{company}}.',{
  contactName:'Ana',company:'ORYNEO',
 });
 expect(rendered==='Olá, Ana — ORYNEO.','canonical variables were not rendered');
});

Deno.test('rejects unknown, missing and header-breaking values',()=>{
 for(const [template,context] of [
  ['Olá {{arbitrary_secret}}',{contactName:'Ana',company:'ORYNEO'}],
  ['Olá {{contact_name}}',{contactName:'',company:'ORYNEO'}],
  ['Olá {{contact_name}}',{contactName:'Ana\r\nBcc: x@y.test',company:'ORYNEO'}],
 ] as const){
  let denied=false;
  try{renderApprovedEmailText(template,context);}catch{denied=true;}
  expect(denied,'unsafe email rendering was accepted');
 }
});
