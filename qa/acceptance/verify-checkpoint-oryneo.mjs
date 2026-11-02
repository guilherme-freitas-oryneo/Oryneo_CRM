import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';

const data=JSON.parse(readFileSync('qa/acceptance/checkpoint-master-20261031.json','utf8'));
const markdown=readFileSync('docs/automation/ZIP_CHECKPOINT_MASTER_20261031.md','utf8');
assert.equal(data.schema_version,'1.0','Keep the original versioned rubric');
assert.equal(data.total,70,'The denominator must stay fixed at 70');
assert.equal(data.phases.length,7,'Seven ZIP phases are mandatory');
const all=[];
for(const [phaseIndex,phase] of data.phases.entries()){
 assert.equal(phase.id,'F'+phaseIndex,'Phase order must not drift');
 assert.equal(phase.checks.length,10,'Ten permanent criteria per phase');
 assert.ok(markdown.includes('### '+phase.id+' — '+phase.title),'Phase missing from Markdown');
 for(const [index,item] of phase.checks.entries()){
  assert.equal(item.number,index+1,'Criterion number changed');
  assert.ok(typeof item.criterion==='string'&&item.criterion.trim(),'Empty criterion');
  assert.ok(typeof item.evidence==='string'&&item.evidence.trim(),'Evidence note missing');
  assert.ok([0,0.5,1].includes(item.score),'Unsupported score: '+phase.id+':'+item.number);
  assert.ok(markdown.includes('| '+item.number+' | '+item.criterion+' | '+String(item.score)+' | '+item.evidence+' |'),'Markdown/JSON evidence drift '+phase.id+':'+item.number);
  all.push(item);
 }
}
assert.equal(all.length,70);
const score=all.reduce((n,item)=>n+item.score,0);
const percentage=Number((100*score/70).toFixed(2));
assert.equal(data.points,score,'Point sum does not match verified criteria');
assert.equal(data.percentage,percentage,'Percentage does not equal verified points');
assert.ok(markdown.includes('**'+percentage.toFixed(2)+'%**'),'Markdown total stale');
assert.equal(data.live_release_authorized,false,'The checkpoint must never assert live release authorization');
console.log('ORYNEO CHECKPOINT VERIFIED: '+score+'/70 = '+percentage.toFixed(2)+'%');
console.log('Note: documentation consistency is not proof of production acceptance.');
