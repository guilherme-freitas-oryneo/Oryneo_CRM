import {freshApprovedTemplate,sendVerifiedTemplate,type Requester}
 from '../automation-api/metaTemplateTransport.ts';
const check=(v:unknown,m:string)=>{if(!v)throw Error(m)};
const config={recipient:'5521999887766',name:'oryneo_meta_qa_v3',
 locale:'pt_BR',values:['Contato QA'],expectedCount:1};
const proof={id:'123456789123456',name:'oryneo_meta_qa_v3',
 language:'pt_BR' as const,category:'UTILITY' as const,variable_numbers:['1']};
const valid={id:proof.id,name:proof.name,status:'APPROVED',
 language:'pt_BR',category:'UTILITY',
 components:[{type:'BODY',text:'Olá, {{1}}.'}]};
Deno.test('fresh Graph approval is required before send',async()=>{
 let seen='';
 const get:Requester=async(url,init)=>{
  seen=String(url);
  check(init?.method==='GET','approval not read');
  check(String((init?.headers as Record<string,string>)?.Authorization)==='Bearer fake-token',
   'missing auth');
  return new Response(JSON.stringify(valid),{status:200});
 };
 check(await freshApprovedTemplate(get,'fake-token',proof),'fresh approval not accepted');
 check(seen.includes('/'+proof.id+'?fields='),'wrong Meta endpoint');
 const paused:Requester=async()=>new Response(JSON.stringify({...valid,status:'PAUSED'}),{status:200});
 check(!(await freshApprovedTemplate(paused,'fake-token',proof)),
  'paused Meta template accepted');
});
Deno.test('successful Meta message requires provider receipt and exact payload',async()=>{
 let count=0;
 const send:Requester=async(_url,init)=>{
  count++;
  const b=JSON.parse(String(init?.body));
  check(b.type==='template'&&b.to==='5521999887766','recipient corruption');
  check(b.template.components[0].parameters[0].text==='Contato QA','variable lost');
  return new Response(JSON.stringify({messages:[{id:'wamid.synthetic.valid'}]}),{status:200});
 };
 const r=await sendVerifiedTemplate(send,'fake-token','123456789123456',config);
 check(r.kind==='accepted'&&r.receipt==='wamid.synthetic.valid','missing acceptance');
 check(count===1,'automatically retried accepted message');
});
Deno.test('timeouts, HTTP 5xx and no receipt do not cause retries',async()=>{
 let calls=0;
 const bad:Requester=async()=>{
  calls++;
  throw Error('simulated socket timeout');
 };
 const result=await sendVerifiedTemplate(bad,'fake-token','123456789123456',config);
 check(result.kind==='uncertain'&&calls===1,'timeout retried or marked definite');
 const failed:Requester=async()=>new Response(JSON.stringify({error:{code:131000}}),{status:503});
 check((await sendVerifiedTemplate(failed,'fake-token','123456789123456',config)).kind==='uncertain',
  'server failure marked non-send');
 const idless:Requester=async()=>new Response(JSON.stringify({messages:[]}),{status:200});
 check((await sendVerifiedTemplate(idless,'fake-token','123456789123456',config)).kind==='uncertain',
  'idless accepted response wrongly marked sent');
});
Deno.test('structured HTTP 400 is definitive but not retried automatically',async()=>{
 let calls=0;
 const declined:Requester=async()=>{calls++;return new Response(
  JSON.stringify({error:{code:132001}}),{status:400});};
 const r=await sendVerifiedTemplate(declined,'fake-token','123456789123456',config);
 check(r.kind==='definitive_rejection'&&calls===1,'definitive refusal not held');
});
Deno.test('static template transport sends exact no-variable payload once',async()=>{
 let calls=0;
 const send:Requester=async(_url,init)=>{
  calls++;
  const body=JSON.parse(String(init?.body));
  check(body.template.name==='oryneo_contato_estatico_v1','wrong static template');
  check(!('components' in body.template),'empty body components sent');
  return new Response(JSON.stringify({messages:[{id:'wamid.synthetic.static'}]}),{status:200});
 };
 const result=await sendVerifiedTemplate(send,'fake-token','123456789123456',{
  recipient:'5521999887766',name:'oryneo_contato_estatico_v1',
  locale:'pt_BR',values:[],expectedCount:0,
 });
 check(result.kind==='accepted'&&calls===1,'static template send was not accepted once');
});
