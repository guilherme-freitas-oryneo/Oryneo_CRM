import { readFileSync } from 'node:fs';
const audit = JSON.parse(readFileSync('qa/acceptance/checkpoint-master-20261031.json','utf8'));
const criteria = audit.phases.flatMap(phase=>phase.checks);
const score = criteria.reduce((sum,item)=>sum+item.score,0);
if(criteria.length!==70 || score!==54 || audit.percentage!==77.14) throw new Error('CHECKPOINT_MISMATCH');
console.log('ORYNEO checkpoint',criteria.length,score,audit.percentage);
