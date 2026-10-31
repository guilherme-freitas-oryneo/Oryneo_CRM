import {buildMetaTemplateRequest} from '../automation-api/metaTemplateRequest.ts';
const assert=(v:unknown,msg:string)=>{if(!v)throw Error(msg)};
const rejected=(f:()=>unknown)=>{
 try{f();return false}catch{return true}
};
Deno.test('Meta template payload preserves exact ordinal body components',()=>{
 const msg=buildMetaTemplateRequest({
  recipient:'5521999999999',name:'oryneo_proposta_retomada_v3',
  locale:'pt_BR',values:['Cliente Exemplo','Growth'],expectedCount:2,
 });
 assert(msg.type==='template'&&msg.messaging_product==='whatsapp','bad provider contract');
 assert(msg.template.components.length===1,'unsupported component');
 assert(msg.template.components[0].parameters[0].text==='Cliente Exemplo','wrong var order');
 assert(msg.template.components[0].parameters[1].text==='Growth','wrong second var');
 assert(msg.template.language.code==='pt_BR','bad locale');
});
Deno.test('Meta template builder refuses guesses and unsafe values',()=>{
 const base={
  recipient:'5521999999999',name:'oryneo_proposta_retomada_v3',
  locale:'pt_BR',values:['Cliente Exemplo'] as string[],expectedCount:1,
 };
 assert(rejected(()=>buildMetaTemplateRequest({...base,expectedCount:2})),'missing placeholder accepted');
 assert(rejected(()=>buildMetaTemplateRequest({...base,recipient:'not a number'})),'phone injection');
 assert(rejected(()=>buildMetaTemplateRequest({...base,name:'other/slug'})),'bad name');
 assert(rejected(()=>buildMetaTemplateRequest({...base,locale:'en_US'})),'unverified locale');
 assert(rejected(()=>buildMetaTemplateRequest({...base,values:['']})),'empty placeholder');
 assert(rejected(()=>buildMetaTemplateRequest({...base,values:['hello'+String.fromCharCode(10)+'world']})),'multiline placeholder');
});
