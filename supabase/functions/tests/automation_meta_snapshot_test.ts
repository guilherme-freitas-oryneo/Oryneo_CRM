import {verifyMetaTemplateComponents} from '../automation-api/metaTemplateVerifier.ts';
import batch01 from '../../automation/meta_component_evidence_20261030_batch_01.json' with {type:'json'};
import batch02 from '../../automation/meta_component_evidence_20261030_batch_02.json' with {type:'json'};
import batch03 from '../../automation/meta_component_evidence_20261030_batch_03.json' with {type:'json'};
const assert=(v:boolean,m:string)=>{if(!v)throw Error(m)};
Deno.test('official Meta component evidence matches exact registry identity',()=>{
 const batches=[batch01,batch02,batch03];
 assert(batches.every(b=>b.status==='snapshot_only'),'snapshot cannot authorize sends');
 const templates=batches.flatMap(b=>b.templates);
 assert(templates.length===15,'expected fifteen official template records');
 assert(new Set(templates.map(t=>t.provider_template_id)).size===templates.length,
  'same template appears in multiple snapshots');
 for(const entry of templates){
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
