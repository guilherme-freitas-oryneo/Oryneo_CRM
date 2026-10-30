/**
 * ORYNEO automation graph validation boundary (server side).
 *
 * This module validates UNTRUSTED JSON only; it does not publish a workflow,
 * enqueue an event, schedule a timer, send a message or modify billing.
 * Provider references must be read from the database immediately before use.
 */
export type GraphIssue = { code: string; path: string };
export type GraphDecision = {
  ok: boolean;
  issues: GraphIssue[];
  nodeCount: number;
  edgeCount: number;
  dispatchAuthorized: false;
};
export type TrustedReferences = {
  eventTypes: readonly string[];
  stageIds: readonly string[];
  templateIds: readonly string[];
  knowledgeIds: readonly string[];
  dictionaryIds: readonly string[];
};
type JsonRecord = Record<string, unknown>;
const object = (v: unknown): v is JsonRecord => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o: JsonRecord, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const text = (v: unknown, max=160): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const int = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const scalar = (v: unknown) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
const only = (v: JsonRecord, keys: readonly string[]) => Object.keys(v).every(k => keys.includes(k));
const fields = new Set([
  'opportunity.intent', 'opportunity.stage_id', 'opportunity.source',
  'opportunity.plan', 'opportunity.cycle', 'conversation.mode',
  'conversation.opted_out', 'conversation.consent_granted',
  'billing.status', 'billing.paid_verified', 'lead.intent', 'event.type',
]);
const spec: Record<string, { input: boolean; outputs: string[]; kinds: string[]; effect: boolean }> = {
  trigger: { input:false,outputs:['out'],kinds:['sdr','pipeline'],effect:false },
  condition: { input:true,outputs:['yes','no'],kinds:['sdr','pipeline'],effect:false },
  intent_classifier: { input:true,outputs:['out','uncertain'],kinds:['sdr'],effect:false },
  knowledge_lookup: { input:true,outputs:['found','missing'],kinds:['sdr','pipeline'],effect:false },
  ai_generate: { input:true,outputs:['out','error'],kinds:['sdr'],effect:false },
  whatsapp_template: { input:true,outputs:['out','error'],kinds:['sdr','pipeline'],effect:true },
  whatsapp_reply: { input:true,outputs:['out','error'],kinds:['sdr'],effect:true },
  email: { input:true,outputs:['out','error'],kinds:['sdr','pipeline'],effect:true },
  crm_stage_change: { input:true,outputs:['out'],kinds:['pipeline'],effect:true },
  crm_task: { input:true,outputs:['out'],kinds:['sdr','pipeline'],effect:true },
  crm_update: { input:true,outputs:['out'],kinds:['pipeline'],effect:true },
  billing_read: { input:true,outputs:['out'],kinds:['pipeline'],effect:false },
  wait: { input:true,outputs:['out','timeout'],kinds:['sdr','pipeline'],effect:false },
  human_handoff: { input:true,outputs:['out'],kinds:['sdr','pipeline'],effect:true },
  notify: { input:true,outputs:['out'],kinds:['sdr','pipeline'],effect:true },
  stop: { input:true,outputs:[],kinds:['sdr','pipeline'],effect:false },
  end: { input:true,outputs:[],kinds:['sdr','pipeline'],effect:false },
};

/** Avoid implicit truth and unbounded recursive rules from imported drafts. */
function validRule(root: unknown): boolean {
  let count = 0;
  function visit(node: unknown, depth: number): boolean {
    if (++count > 64 || depth > 8 || !object(node)) return false;
    if (node.kind === 'group') {
      return only(node,['kind','op','rules']) && ['all','any'].includes(String(node.op))
        && Array.isArray(node.rules) && node.rules.length > 0 && node.rules.length <= 32
        && node.rules.every(r => visit(r,depth+1));
    }
    if (!fields.has(String(node.field))) return false;
    if (node.kind === 'compare') return only(node,['kind','field','op','value'])
      && ['eq','neq'].includes(String(node.op)) && own(node,'value') && scalar(node.value);
    if (node.kind === 'one_of') return only(node,['kind','field','values'])
      && Array.isArray(node.values) && node.values.length > 0 && node.values.length <= 32
      && node.values.every(scalar);
    return node.kind === 'exists' && only(node,['kind','field']);
  }
  return visit(root,0);
}

/** Strict server-side gate. Passing it is NOT permission to publish or dispatch. */
export function inspectServerGraph(raw: unknown, refs: TrustedReferences): GraphDecision {
  const issues: GraphIssue[] = [];
  const add = (code: string, path: string) => issues.push({code,path});
  const blocked = (nodeCount=0,edgeCount=0): GraphDecision => ({
    ok: issues.length===0,issues,nodeCount,edgeCount,dispatchAuthorized:false,
  });
  if (!object(raw)) { add('GRAPH_INVALID','$'); return blocked(); }
  if (!uuid(raw.id) || !text(raw.name) || !['pipeline','sdr'].includes(String(raw.kind))
    || raw.status !== 'draft' || raw.schema_version !== '1.0.0'
    || !int(raw.version,1,1000000)) add('GRAPH_HEADER_INVALID','$');
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)
    || raw.nodes.length===0 || raw.nodes.length>500 || raw.edges.length>1000) {
    add('GRAPH_SIZE_INVALID','$'); return blocked();
  }
  const nodes = new Map<string, JsonRecord>();
  const edges = new Set<string>();
  const outgoing = new Map<string,Set<string>>();
  let triggerCount=0, terminalCount=0;
  for (const [i,n] of raw.nodes.entries()) {
    const p='nodes['+i+']';
    if (!object(n) || !uuid(n.id) || !text(n.label) || !object(n.config) ||
      !object(n.position) || typeof n.position.x !== 'number' || !Number.isFinite(n.position.x) ||
      typeof n.position.y !== 'number' || !Number.isFinite(n.position.y) ||
      !Array.isArray(n.ports) || n.disabled === true || !spec[String(n.type)]) {
      add('NODE_INVALID',p); continue;
    }
    if (nodes.has(n.id)) add('NODE_DUPLICATE',p);
    nodes.set(n.id,n);
    const descriptor=spec[String(n.type)];
    if (!descriptor.kinds.includes(String(raw.kind))) add('NODE_KIND_INVALID',p);
    const expected=[...(descriptor.input?['in']:[]),...descriptor.outputs];
    if (expected.length!==n.ports.length || !expected.every(x=>n.ports.includes(x))
      || new Set(n.ports).size !== n.ports.length) add('NODE_PORTS_INVALID',p);
    if (n.type==='trigger') {
      triggerCount++;
      if (!only(n.config,['event_type']) || !refs.eventTypes.includes(String(n.config.event_type))) add('TRIGGER_EVENT_INVALID',p);
    }
    if (n.type==='end' || n.type==='stop') { terminalCount++; if (Object.keys(n.config).length) add('TERMINAL_CONFIG_INVALID',p); }
    if (n.type==='condition' && (!only(n.config,['rule']) || !validRule(n.config.rule))) add('CONDITION_INVALID',p);
    if (n.type==='wait' && (!only(n.config,['duration_minutes','cancel_on_reply'])
      || !int(n.config.duration_minutes,1,43200) || typeof n.config.cancel_on_reply!=='boolean')) add('WAIT_INVALID',p);
    if (n.type==='whatsapp_template' && (!only(n.config,['template_registry_id','locale'])
      || !uuid(n.config.template_registry_id) || !refs.templateIds.includes(n.config.template_registry_id)
      || n.config.locale!=='pt_BR')) add('TEMPLATE_NOT_VERIFIED',p);
    if (n.type==='crm_stage_change' && (!only(n.config,['target_stage_id'])
      || !uuid(n.config.target_stage_id) || !refs.stageIds.includes(n.config.target_stage_id))) add('STAGE_NOT_VERIFIED',p);
    if (n.type==='knowledge_lookup' && (!only(n.config,['knowledge_release_id','question_field'])
      || !uuid(n.config.knowledge_release_id) || !refs.knowledgeIds.includes(n.config.knowledge_release_id)
      || !text(n.config.question_field,128))) add('KNOWLEDGE_NOT_VERIFIED',p);
    if (n.type==='intent_classifier' && (!only(n.config,['dictionary_release_id','min_confidence'])
      || !uuid(n.config.dictionary_release_id) || !refs.dictionaryIds.includes(n.config.dictionary_release_id)
      || typeof n.config.min_confidence!=='number' || n.config.min_confidence<0.5
      || n.config.min_confidence>0.99)) add('INTENT_NOT_VERIFIED',p);
    // Never accept an action type without a reviewed adapter policy.
    if (descriptor.effect && !['whatsapp_template','crm_stage_change'].includes(String(n.type))) {
      add('ACTION_ADAPTER_NOT_HOMOLOGATED',p);
    }
    if (n.type==='ai_generate') add('AI_POLICY_NOT_HOMOLOGATED',p);
    if (n.type==='billing_read' && Object.keys(n.config).length) add('BILLING_READ_ONLY',p);
  }
  if (triggerCount!==1) add('TRIGGER_COUNT','nodes');
  if (terminalCount===0) add('TERMINAL_REQUIRED','nodes');
  const adjacency = new Map<string,string[]>();
  for (const [i,e] of raw.edges.entries()) {
    const p='edges['+i+']';
    if (!object(e) || !uuid(e.id) || !uuid(e.source) || !uuid(e.target)
      || typeof e.source_port!=='string' || typeof e.target_port!=='string') {add('EDGE_INVALID',p);continue;}
    if (edges.has(e.id)) add('EDGE_DUPLICATE',p);
    edges.add(e.id);
    const from=nodes.get(e.source),to=nodes.get(e.target);
    if (!from||!to) {add('EDGE_ORPHAN',p);continue;}
    if (e.target_port!=='in' || to.type==='trigger' || !Array.isArray(from.ports) || !from.ports.includes(e.source_port)
      || !Array.isArray(to.ports) || !to.ports.includes('in')) add('EDGE_DIRECTION_INVALID',p);
    const ports=outgoing.get(e.source)||new Set<string>();
    if (ports.has(e.source_port)) add('EDGE_AMBIGUOUS_PORT',p);
    ports.add(e.source_port);outgoing.set(e.source,ports);
    adjacency.set(e.source,[...(adjacency.get(e.source)||[]),e.target]);
  }
  for (const [id,n] of nodes.entries()) {
    for (const port of spec[String(n.type)].outputs) {
      if (!outgoing.get(id)?.has(port)) add('BRANCH_NOT_CONNECTED','node:'+id+':'+port);
    }
  }
  const visited=new Set<string>(),active=new Set<string>();
  function walk(id:string) {
    if (active.has(id)) {add('CYCLE_DETECTED','node:'+id);return;}
    if (visited.has(id)) return;
    active.add(id);
    for(const next of adjacency.get(id)||[]) walk(next);
    active.delete(id);visited.add(id);
  }
  for(const [id,n] of nodes.entries()) if (n.type==='trigger') walk(id);
  for(const id of nodes.keys()) if(!visited.has(id)) add('NODE_UNREACHABLE','node:'+id);
  return blocked(raw.nodes.length,raw.edges.length);
}
