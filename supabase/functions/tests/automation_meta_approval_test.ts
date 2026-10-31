import {inspectFreshMetaApproval,renderVerifiedMetaTemplate}
 from '../automation-api/metaTemplateApproval.ts';
const requireTrue=(v:unknown,m:string)=>{if(!v)throw Error(m)};
const expected={id:'123456789012345',name:'oryneo_fup_test_v3',
 language:'pt_BR' as const,category:'UTILITY' as const,
 variable_numbers:['1','2'] as const};
const live={id:expected.id,name:expected.name,language:'pt_BR',
 category:'UTILITY',status:'APPROVED',
 components:[{type:'BODY',text:'Oi, {{1}}! Sua prioridade: {{2}}.'}]};
Deno.test('fresh exact Meta approval produces ordered, escaped-by-provider values',()=>{
 const proof=inspectFreshMetaApproval(live,expected);
 requireTrue(proof.approved,'approved template rejected');
 if(!proof.approved)return;
 const rendered=renderVerifiedMetaTemplate(proof.body,['1','2'],['Mariana','Organizar retornos']);
 requireTrue(rendered==='Oi, Mariana! Sua prioridade: Organizar retornos.','wrong template rendering');
});
Deno.test('paused, rejected, identity drift and component drift fail closed',()=>{
 for(const altered of [
  {...live,status:'PAUSED'},
  {...live,status:'REJECTED'},
  {...live,id:'999999999999999'},
  {...live,language:'en_US'},
  {...live,category:'MARKETING'},
  {...live,components:[{type:'BODY',text:'Oi, {{1}}!'}]},
  {...live,components:[{type:'BODY',text:'Oi, {{2}}! {{1}}.'}]},
  {...live,components:[{type:'HEADER',text:'Hello'}]},
 ]){
  requireTrue(inspectFreshMetaApproval(altered,expected).approved===false,
    'unverified/changed Meta template accepted');
 }
});
Deno.test('no fake placeholder fallback or oversized rendered text',()=>{
 let denied=false;
 try{renderVerifiedMetaTemplate('Oi, {{2}}',['1'],['Mariana'])}
 catch{denied=true}
 requireTrue(denied,'missing variable silently accepted');
 denied=false;
 try{renderVerifiedMetaTemplate('Oi, {{1}}',['1'],['x'.repeat(4500)])}
 catch{denied=true}
 requireTrue(denied,'oversized message allowed');
});
