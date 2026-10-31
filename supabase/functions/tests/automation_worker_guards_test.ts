import {
 isCanonicalUuid, validWorkerToken, workerIsConfigured,
} from '../automation-shadow-worker/workerGuards.ts';

const assert=(condition:boolean,message:string)=>{
 if(!condition)throw Error(message);
};
const validConfig=()=>({
 enabled:true,
 projectUrl:'https://ucikrafwfzamxvweuvgk.supabase.co',
 serviceRole:'local-fixture-not-a-real-secret',
 workspaceId:'11111111-1111-4111-8111-111111111111',
 workerSecret:'x'.repeat(48),
});
Deno.test('shadow worker accepts standard Supabase 5-group UUIDs',()=>{
 assert(isCanonicalUuid('11111111-1111-4111-8111-111111111111'),
   'valid canonical workspace ID was rejected');
 assert(isCanonicalUuid('A623469A-34C8-4C21-9A44-7E20CC7DF502'),
   'case-insensitive UUID must work');
 assert(!isCanonicalUuid('11111111-1111-4111-1111111111111111'),
   'legacy invalid four-group pattern must be rejected');
 assert(!isCanonicalUuid('11111111-1111-4111-8111-111111111111/another'),
   'trailing untrusted data accepted');
});
Deno.test('shadow worker is closed unless all explicit configuration gates pass',()=>{
 const c=validConfig();
 assert(workerIsConfigured(c),'valid hosted worker configuration was rejected');
 for(const overrides of [
  {enabled:false},{workspaceId:'bad'},
  {projectUrl:''},{projectUrl:'http://ucikrafwfzamxvweuvgk.supabase.co'},
  {projectUrl:'https://evil.example'},
  {projectUrl:'https://ucikrafwfzamxvweuvgk.supabase.co.evil.example'},
  {serviceRole:''},{workerSecret:'too-short'},
 ])assert(!workerIsConfigured({...c,...overrides}),
  'Unsafe worker configuration accepted: '+JSON.stringify(Object.keys(overrides)));
});
Deno.test('shadow worker header requires whole matching 32+ character secret',()=>{
 const secret='realistic-fixture-secret-not-for-production-123456789';
 assert(validWorkerToken(secret,secret),'legitimate worker token rejected');
 for(const candidate of [
  '',secret.slice(1),secret+'x','x'+secret.slice(1),
  secret.slice(0,-1)+'x','other-but-long-enough'.padEnd(secret.length,'x'),
 ])assert(!validWorkerToken(candidate,secret),
   'Incorrect worker token accepted');
 assert(!validWorkerToken('short','short'),
   'Insufficient-length shared secret accepted');
});
