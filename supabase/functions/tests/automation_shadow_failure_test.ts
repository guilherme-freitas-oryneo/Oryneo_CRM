import { shadowFailureCode, SHADOW_FAILURE_CODES } from '../automation-shadow-worker/failurePolicy.ts';
function assert(ok:boolean,description:string){if(!ok)throw Error(description);}
Deno.test('shadow failure codes are finite, sanitized and recognized',()=>{
 for(const code of SHADOW_FAILURE_CODES){
  assert(/^[A-Z][A-Z0-9_]{2,63}$/.test(code),'invalid code');
  assert(shadowFailureCode(new Error(code))===code,'known code missing');
 }
});
Deno.test('shadow failures never store arbitrary provider/customer text',()=>{
 for(const error of [
  new Error('Customer: customer@example.com'),
  new Error('SHADOW_ACK_FAILED customer@example.com'),
  'SHADOW_ACK_FAILED',
  {message:'SHADOW_ACK_FAILED'},
  new Error('Authorization: Bearer sample-secret'),
  null,undefined,{get message(){throw Error('hostile getter');}},
 ]){
  assert(shadowFailureCode(error)==='SHADOW_UNEXPECTED_FAILURE','PII leak');
 }
});
