import {verifyMetaTemplateComponents} from '../automation-api/metaTemplateVerifier.ts';
import evidence from '../../automation/meta_component_evidence_20261030_batch_01.json' with {type:'json'};
const assert=(v:boolean,m:string)=>{if(!v)throw Error(m)};
Deno.test('official Meta component evidence matches exact registry identity',()=>{
 assert(evidence.status==='snapshot_only','snapshot cannot authorize sends');
 assert(evidence.templates.length===5,'expected five official template records');
 for(const entry of evidence.templates){
  const check=verifyMetaTemplateComponents({
   id:entry.provider_template_id,name:entry.template_name,
   language:entry.language,category:entry.category,
   status:entry.status,parameter_format:entry.parameter_format,
   components:entry.components,
  },{
   template_name:entry.template_name,provider_template_id:entry.provider_template_id,
   language:entry.language,category:entry.category,
  });
  assert(check.ok&&check.schema.components_verified,
   entry.template_name+' official component snapshot did not pass '+check.issues.join(','));
  assert(check.schema.send_guard==='backend_required'&&check.schema.snapshot_only,
   'Meta approval snapshot escalated to dispatch authorization');
 }
});
