import {verifyMetaTemplateComponents as verify} from '../automation-api/metaTemplateVerifier.ts';
const reg={template_name:'oryneo_fup_1h_aquisicao_v3',provider_template_id:'996083893513934',language:'pt_BR',category:'MARKETING'};
const body={type:'BODY',text:'Oi, {{1}}! Como estão as oportunidades?',example:{body_text:[['Mariana']]}};
const source=()=>({id:reg.provider_template_id,name:reg.template_name,
 language:reg.language,category:reg.category,status:'APPROVED',
 parameter_format:'POSITIONAL',components:[structuredClone(body)]});
const assert=(ok:boolean,why:string)=>{if(!ok)throw new Error(why)};
Deno.test('Meta official body and examples match exact approved ID',()=>{
 const x=verify(source(),reg);
 assert(x.ok,'legitimate approved official template failed');
 assert(x.schema.variable_numbers.join(',')==='1','placeholder was not extracted');
 assert(x.schema.snapshot_only&&x.schema.send_guard==='backend_required',
   'component check could be misused for real sends');
});
Deno.test('cross-account, old version and paused Meta template are blocked',()=>{
 const other=source();other.id='arbitrary';
 assert(verify(other,reg).issues.includes('TEMPLATE_IDENTITY_MISMATCH'),
   'wrong template ID accepted');
 const paused=source();paused.status='PAUSED';
 assert(verify(paused,reg).issues.includes('TEMPLATE_NOT_APPROVED'),
   'paused template authorized');
});
Deno.test('numeric variables must be contiguous and examples must match',()=>{
 const bad=source();bad.components=[{type:'BODY',text:'Olá {{1}} e {{3}}',
   example:{body_text:[['A','B']]}}];
 const result=verify(bad,reg);
 assert(!result.ok&&result.issues.includes('BODY_PLACEHOLDERS_INVALID'),
   'gap in variable sequence accepted');
 assert(result.schema.components_verified===false&&result.schema.meta_components.length===0,
   'unverified components were accidentally exported');
 const wrong=source();wrong.components=[{type:'BODY',
   text:'Olá {{1}} {{2}}',example:{body_text:[['A']]}}];
 assert(verify(wrong,reg).issues.includes('BODY_EXAMPLE_MISMATCH'),
   'placeholders lack required parameter samples');
});
Deno.test('unsupported Meta buttons and media may not be declared verified',()=>{
 const other=source();other.components=[body,{type:'BUTTONS',buttons:[{type:'FLOW'}]}];
 assert(verify(other,reg).issues.includes('COMPONENT_UNSUPPORTED'),
   'buttons accepted without formal adapter');
 const media=source();media.components=[body,{type:'HEADER',format:'IMAGE'}];
 assert(verify(media,reg).issues.includes('HEADER_VARIABLE_UNSUPPORTED'),
   'media accepted without media hydration');
});
Deno.test('no body, empty body and invalid named placeholders fail closed',()=>{
 const empty=source();empty.components=[];
 assert(verify(empty,reg).issues.includes('BODY_REQUIRED'),'body missing accepted');
 const named=source();named.components=[{type:'BODY',text:'Olá {{nome}}',
   example:{body_text:[['Mariana']]}}];
 assert(!verify(named,reg).ok,'named placeholders accepted despite positional format');
});
