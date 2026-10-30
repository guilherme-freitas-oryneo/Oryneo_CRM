import { inspectServerGraph, type TrustedReferences } from '../automation-api/graphGuard.ts';

const id = (part: number) => '00000000-0000-4000-8000-' + String(part).padStart(12,'0');
const refs: TrustedReferences = {
  eventTypes:['opportunity.created'],stageIds:[],templateIds:[],knowledgeIds:[],dictionaryIds:[],
};
const valid = () => ({
  id:id(1),name:'Pipeline sem efeitos',kind:'pipeline',status:'draft',version:1,schema_version:'1.0.0',
  nodes:[
    {id:id(2),type:'trigger',label:'Início',position:{x:0,y:0},
      config:{event_type:'opportunity.created'},ports:['out']},
    {id:id(3),type:'condition',label:'Regra',position:{x:300,y:0},
      config:{rule:{kind:'group',op:'all',rules:[
        {kind:'compare',field:'opportunity.intent',op:'eq',value:'conversation'},
        {kind:'exists',field:'conversation.mode'},
      ]}},ports:['in','yes','no']},
    {id:id(4),type:'end',label:'Fim A',position:{x:600,y:0},config:{},ports:['in']},
    {id:id(5),type:'end',label:'Fim B',position:{x:600,y:200},config:{},ports:['in']},
  ],
  edges:[
    {id:id(6),source:id(2),source_port:'out',target:id(3),target_port:'in'},
    {id:id(7),source:id(3),source_port:'yes',target:id(4),target_port:'in'},
    {id:id(8),source:id(3),source_port:'no',target:id(5),target_port:'in'},
  ],
});
const codes = (input: unknown, reference=refs) => inspectServerGraph(input,reference).issues.map(x=>x.code);
const expect = (ok: boolean, reason: string) => { if(!ok) throw new Error(reason); };
Deno.test('well-formed typed branch is structurally accepted but never authorizes dispatch',()=>{
  const x=inspectServerGraph(valid(),refs);
  expect(x.ok,'valid graph should pass: '+JSON.stringify(x.issues));
  expect(x.dispatchAuthorized===false,'dispatch must always be blocked');
  expect(x.nodeCount===4&&x.edgeCount===3,'counts should match');
});
Deno.test('rejects conceptual schema and published JSON at draft entry',()=>{
  const a=valid();a.schema_version='0.1-concept';
  expect(codes(a).includes('GRAPH_HEADER_INVALID'),'conceptual draft must fail');
  const b=valid();b.status='published';
  expect(codes(b).includes('GRAPH_HEADER_INVALID'),'published imports must fail');
});
Deno.test('rejects missing conditional branches, cycles and edges to outputs',()=>{
  const a=valid();a.edges.pop();expect(codes(a).includes('BRANCH_NOT_CONNECTED'),'missing branch rejected');
  const b=valid();b.edges[2].target=id(3);
  expect(codes(b).includes('CYCLE_DETECTED'),'cycle rejected');
  const c=valid();c.edges[0].target_port='out';
  expect(codes(c).includes('EDGE_DIRECTION_INVALID'),'edge cannot target output');
});
Deno.test('rejects untrusted condition fields and deep groups',()=>{
  const a=valid();
  a.nodes[1].config={rule:{kind:'compare',field:'billing.card_number',op:'eq',value:'anything'}};
  expect(codes(a).includes('CONDITION_INVALID'),'unlisted billing data cannot be read');
  const b=valid();let rule: unknown = {kind:'exists',field:'opportunity.plan'};
  for(let i=0;i<10;i++)rule={kind:'group',op:'all',rules:[rule]};
  b.nodes[1].config={rule};
  expect(codes(b).includes('CONDITION_INVALID'),'unbounded recursive rules rejected');
});
Deno.test('rejects disconnected and duplicated IDs',()=>{
  const a=valid();a.nodes.push({id:id(9),type:'end',label:'Órfão',position:{x:900,y:0},config:{},ports:['in']});
  expect(codes(a).includes('NODE_UNREACHABLE'),'orphan node rejected');
  const b=valid();b.edges[1].id=b.edges[0].id;
  expect(codes(b).includes('EDGE_DUPLICATE'),'duplicate edge IDs rejected');
});
Deno.test('effect actions require reviewed policy and verified references',()=>{
  const a=valid();
  a.nodes[1].type='whatsapp_template';
  a.nodes[1].ports=['in','out','error'];
  a.nodes[1].config={template_registry_id:id(33),locale:'pt_BR'};
  a.edges[1].source_port='out';a.edges[2].source_port='error';
  expect(codes(a).includes('TEMPLATE_NOT_VERIFIED'),'approved template without verified components rejected');
  const accepted=inspectServerGraph(a,{...refs,templateIds:[id(33)]});
  expect(accepted.ok,'verified references may be inspected: '+JSON.stringify(accepted.issues));
  expect(!accepted.dispatchAuthorized,'reference inspection never authorizes dispatch');
  const b=valid();b.nodes[1].type='email';b.nodes[1].ports=['in','out','error'];
  b.edges[1].source_port='out';b.edges[2].source_port='error';
  expect(codes(b).includes('ACTION_ADAPTER_NOT_HOMOLOGATED'),'email blocked until adapter audited');
});
Deno.test('rejects unspecified event types or extra node ports',()=>{
  const a=valid();a.nodes[0].config={event_type:'stripe.charge_anything'};
  expect(codes(a).includes('TRIGGER_EVENT_INVALID'),'unknown event not executable');
  const b=valid();b.nodes[0].ports=['out','surprise'];
  expect(codes(b).includes('NODE_PORTS_INVALID'),'unknown port rejected');
});
