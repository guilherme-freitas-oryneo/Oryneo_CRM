/**
 * Stage 6 release verifier. This is deliberately fail-closed: an isolated test,
 * a deployment or a safe hosted snapshot can never be promoted to live proof.
 */
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';

const readJson=path=>JSON.parse(readFileSync(path,'utf8'));
const snapshot=readJson('qa/release/stage6-hosted-snapshot.json');
const map=readJson('qa/acceptance/stage5-evidence-map.json');
const requiredGates=[
  'global:legal','global:playbook','global:rollback','global:security',
  'global:authenticated_e2e',
];
const requiredChannels=['billing','crm','email','onboarding','whatsapp'];

assert.equal(snapshot.schema,'oryneo-stage6-hosted-snapshot-v1');
assert.match(snapshot.sourceCommit,/^[0-9a-f]{40}$/);
assert.ok(!Number.isNaN(Date.parse(snapshot.capturedAt)),'Invalid capture timestamp');
assert.equal(snapshot.captureMethod,'supabase-read-only-sql');
assert.equal(snapshot.workspace.slug,'oryneo-crm');
assert.equal(snapshot.workspace.active,false,'Workspace unexpectedly active');
assert.equal(snapshot.runtime.mode,'disabled','Runtime unexpectedly enabled');
assert.equal(snapshot.runtime.emergencyStop,true,'Emergency stop unexpectedly off');
assert.deepEqual(Object.keys(snapshot.channelOwners).sort(),requiredChannels);
for(const channel of requiredChannels)
  assert.equal(snapshot.channelOwners[channel],'legacy',`${channel} ownership changed`);
for(const [key,value] of Object.entries(snapshot.counts))
  assert.equal(value,0,`${key} is no longer zero; refresh and investigate hosted evidence`);
assert.deepEqual(snapshot.globalMissingGates,requiredGates);
assert.deepEqual(Object.keys(snapshot.channelMissingGates).sort(),requiredChannels);
for(const channel of requiredChannels){
  const missing=snapshot.channelMissingGates[channel];
  assert.deepEqual(missing.slice(0,requiredGates.length),requiredGates,
    `${channel} global gate list drifted`);
  assert.ok(missing.includes(`${channel}:provider_verified`),`${channel} provider gate missing`);
  assert.ok(missing.includes(`${channel}:consent_policy`),`${channel} consent gate missing`);
  assert.ok(missing.includes(`${channel}:single_owner`),`${channel} ownership gate missing`);
}
assert.ok(snapshot.channelMissingGates.email.includes('email:mailbox_verified'));
assert.ok(snapshot.channelMissingGates.billing.includes('billing:financial_webhook'));
assert.ok(snapshot.channelMissingGates.billing.includes('billing:terms_accepted'));
assert.equal(snapshot.decision,'NO_GO_LIVE');

assert.equal(map.count,47);
assert.equal(map.records.length,47);
assert.equal(map.records.filter(item=>item.liveValidated===true).length,0,
  'Live evidence must be reviewed separately and cannot be inferred here');

const requiredFiles=[
  'supabase/automation/stage6_hosted_readiness.readonly.sql',
  'supabase/automation/release_attestation_interlock.qa.sql',
  'supabase/automation/rollback_disabled.qa.sql',
  'docs/automation/STAGE6_RELEASE_EVIDENCE_20261102.md',
  '.github/workflows/qa-oryneo-automations.yml',
];
for(const path of requiredFiles) assert.ok(existsSync(path),`Missing ${path}`);
const workflow=readFileSync('.github/workflows/qa-oryneo-automations.yml','utf8');
for(const anchor of [
  'Provar interlock de release, aprovação, revogação e isolamento de canal',
  'Provar versionamento, revisão otimista, papel e zero ações no rollback',
  'Verificar a decisão fail-closed da etapa final',
]) assert.ok(workflow.includes(anchor),`Missing release gate: ${anchor}`);
const hostedQuery=readFileSync('supabase/automation/stage6_hosted_readiness.readonly.sql','utf8');
assert.match(hostedQuery,/^-- ORYNEO Stage 6 hosted readiness snapshot/);
assert.doesNotMatch(hostedQuery,/\b(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke|call)\b/i,
  'Hosted readiness query must remain read-only');

const report={
  schema:'oryneo-stage6-release-report-v1',
  generatedAt:new Date().toISOString(),
  sourceCommit:snapshot.sourceCommit,
  hostedSnapshot:snapshot.capturedAt,
  isolatedAcceptance:{referenced:47,liveValidated:0},
  safeStateVerified:true,
  decision:'NO_GO_LIVE',
  blockers:requiredGates,
  channelBlockers:snapshot.channelMissingGates,
  statement:'Code release may proceed with the runtime disabled. Live activation and channel cutover remain prohibited.',
};
mkdirSync('qa/acceptance/report',{recursive:true});
writeFileSync('qa/acceptance/report/stage6-release-evidence.json',JSON.stringify(report,null,2)+'\n');
console.log('stage6-release: safe code rollout verified; live activation NO-GO (5 independent gates missing)');
