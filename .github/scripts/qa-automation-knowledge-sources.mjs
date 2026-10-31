/**
 * Release drift guard. Never pushes a changed playbook into the production SDR.
 * A source edit invalidates this pinned, unapproved knowledge release until
 * it is explicitly reviewed, versioned and rebuilt.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const manifest=JSON.parse(readFileSync(
 'supabase/automation/knowledge_source_manifest_20261030.json','utf8'));
const playbook=readFileSync('src/playbook/content.ts','utf8');
const catalog=readFileSync('supabase/functions/_shared/billing/catalog.ts','utf8');
assert.equal(manifest.schema,'oryneo-knowledge-source-manifest-v1');
assert.equal(manifest.status,'draft');
assert.equal(manifest.sdr_training_status,'not_enabled');
assert.equal(manifest.legal_terms_status,'unverified_blocked');
assert.equal(manifest.dispatch_authorized,false);
assert.match(playbook, /export const CONTENT_VERSION = '1\.0\.0';/);
const content=JSON.stringify({
 format:'oryneo-knowledge-sources-v1',
 version:manifest.content_version,
 playbook,catalog,
});
const digest=createHash('sha256').update(content,'utf8').digest('hex');
assert.equal(digest,manifest.content_sha256,
 'Playbook or billing catalog drift detected. A new release needs explicit review.');
assert.deepEqual(manifest.canonical_sources.map(x=>x.path),[
 'src/playbook/content.ts','supabase/functions/_shared/billing/catalog.ts',
]);
console.log('ORYNEO canonical knowledge source digest verified; SDR sync remains disabled');
