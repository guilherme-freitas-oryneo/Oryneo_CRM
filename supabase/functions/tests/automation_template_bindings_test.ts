import {validateTemplateBindings,resolveTemplateBindings} from '../automation-api/templateBindings.ts';
const assert=(value:unknown,message:string)=>{if(!value)throw Error(message)};
Deno.test('explicit numeric Meta placeholders map to canonical fields without guessing',()=>{
 const bindings={'1':'conversation.customer_name','2':'opportunity.plan','3':'billing.company'};
 const expected=['1','2','3'];
 assert(validateTemplateBindings(bindings,expected).ok,'approved bindings rejected');
 const result=resolveTemplateBindings(bindings,expected,{
  conversation:{customer_name:'Cliente Exemplo'},
  opportunity:{plan:'Growth'},billing:{company:'Empresa Exemplo'},
 });
 assert(result.ok,'canonical values did not resolve');
 if(result.ok)assert(result.values.join('|')==='Cliente Exemplo|Growth|Empresa Exemplo','wrong ordering');
});
Deno.test('no implicit placeholder values or unapproved fields',()=>{
 assert(!validateTemplateBindings(undefined,['1']).ok,'missing mapping accepted');
 assert(!validateTemplateBindings({'1':'email.address'},['1']).ok,'unapproved PII accepted');
 assert(!validateTemplateBindings({'2':'opportunity.plan'},['1']).ok,'incorrect index accepted');
 assert(!validateTemplateBindings({'1':'opportunity.plan','2':'opportunity.cycle'},['1']).ok,'extra variable accepted');
 assert(!validateTemplateBindings({'1':'__proto__.password'},['1']).ok,'prototype traversal accepted');
});
Deno.test('unknown canonical context returns a safe block',()=>{
 const x=resolveTemplateBindings({'1':'opportunity.plan'},['1'],{opportunity:{}});
 assert(x.ok===false,'missing plan invented');
 const y=resolveTemplateBindings({'1':'conversation.customer_name'},['1'],{
  conversation:{customer_name:'A'+String.fromCharCode(10)+'B'},
 });
 assert(y.ok===false,'newline injected into Meta parameter');
});
Deno.test('bad Meta component index snapshot cannot publish',()=>{
 assert(!validateTemplateBindings({'1':'opportunity.plan'},['1','1']).ok,'duplicate official index accepted');
 assert(!validateTemplateBindings({'1':'opportunity.plan'},['0']).ok,'zero index accepted');
 assert(!validateTemplateBindings({'1':'opportunity.plan'},['100']).ok,'oversized variable number accepted');
});
Deno.test('approved static template resolves with no invented bindings',()=>{
 assert(validateTemplateBindings(undefined,[]).ok,'static template rejected by validation');
 const result=resolveTemplateBindings(undefined,[],{});
 assert(result.ok&&result.values.length===0,'static template must resolve to no parameters');
 assert(!validateTemplateBindings({'1':'opportunity.plan'},[]).ok,
  'extra binding on static template accepted');
});
