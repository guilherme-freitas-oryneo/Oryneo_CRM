/**
 * Stage 5 acceptance-trace verifier. Evidence references are NEVER equated
 * with production E2E proof: this tool validates 47 case references and exports
 * a machine-readable index of test assertions executed by the CI suite.
 */
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,sep} from 'node:path';
const source='qa/acceptance/stage5-evidence-map.json';
const input=JSON.parse(readFileSync(source,'utf8'));
const expected=[
 ...['B01','B02','B03'],
 ...Array.from({length:13},(_,i)=>'S'+String(i+1).padStart(2,'0')),
 ...Array.from({length:10},(_,i)=>'P'+String(i+1).padStart(2,'0')),
 ...Array.from({length:12},(_,i)=>'E'+String(i+1).padStart(2,'0')),
 ...Array.from({length:6},(_,i)=>'C'+String(i+1).padStart(2,'0')),
 ...['K01','K02','K03'],
];
assert.equal(input.schema,'oryneo-acceptance-evidence-v1');
assert.equal(input.count,47);
assert.ok(input.source.endsWith('/qa/matriz_aceite.csv'));
assert.deepEqual(input.records.map(x=>x.id),expected,'Missing/duplicate/out-of-order ZIP scenarios');
const groups={B:3,S:13,P:10,E:12,C:6,K:3};
const report=[];
for(const rec of input.records){
 assert.equal(typeof rec.path,'string');
 assert.equal(typeof rec.needle,'string');
 assert.ok(rec.needle.length>=10,'Weak evidence anchor for '+rec.id);
 assert.ok(rec.level==='read_only_audit'||['unit','component','ui_component','browser','db_integration'].includes(rec.level));
 const file=resolve(process.cwd(),rec.path);
 assert.ok(file.startsWith(process.cwd()+sep),'Invalid evidence path '+rec.id);
 assert.ok(existsSync(file),'Missing evidence source '+rec.id+': '+rec.path);
 const text=readFileSync(file,'utf8');
 assert.ok(text.includes(rec.needle),'Missing asserted behavior for '+rec.id+' in '+rec.path+' ['+rec.needle+']');
 assert.equal(rec.liveValidated,false,'No live provider E2E was authorized for '+rec.id);
 report.push({id:rec.id,group:rec.id[0],evidence:rec.path,
  evidenceAnchor:rec.needle,coverageLevel:rec.level,
  referenceVerified:true,ciJob:rec.level==='browser'?'editor-browser-qa':
   rec.level==='db_integration'?'schema-isolation':
   rec.path.includes('/src/')||rec.path.startsWith('src/')?'crm-regression':
   rec.level==='read_only_audit'?'baseline-read-only':'failure-policy',
  // Set only after the referenced suite has been run; never claim the outcome
  // of a separate CI job from this isolated metadata validation.
  result:'EVIDENCE_REFERENCED_NOT_EXECUTION_STATUS',
  providerE2E:'NOT_EXECUTED_OR_AUTHORIZED',
 });
}
for(const [group,n] of Object.entries(groups)){
 assert.equal(report.filter(r=>r.group===group).length,n,'Group coverage mismatch '+group);
}
const safe=readFileSync('supabase/automation/sdr_semantic_release.preview.sql','utf8');
assert.match(safe,/enabled boolean NOT NULL DEFAULT false CHECK\(enabled=false\)/);
const worker=readFileSync('supabase/functions/whatsapp-ai-worker/index.ts','utf8');
assert.match(worker,/ORYNEO_SDR_INTELLIGENCE_ENABLED/);
assert.match(worker,/=== 'true'/);
const workflow=readFileSync('.github/workflows/qa-oryneo-automations.yml','utf8');
for(const name of ['schema-isolation:','crm-regression:','failure-policy:','editor-browser-qa:']){
 assert.ok(workflow.includes(name),'Regression job disappeared '+name);
}
mkdirSync('qa/acceptance/report',{recursive:true});
writeFileSync('qa/acceptance/report/stage5-evidence.json',
 JSON.stringify({source:input.source,scenarioCount:47,
  referenced:report.length,liveValidated:0,
  caveat:'This index verifies the presence of executable tests and evidence. Results depend on independent CI jobs, and no live provider E2E is asserted.',
  scenarios:report},null,2)+'\n');
console.log('stage5-evidence-index: '+report.length+'/47 references verified; live provider E2E not authorized');
