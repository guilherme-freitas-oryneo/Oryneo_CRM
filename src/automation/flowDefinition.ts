/**
 * Pure, isolated automation graph contract.
 * This module has no network, storage or provider imports.
 * It cannot emit WhatsApp/e-mail, change CRM stages or charge Stripe.
 */
export type FlowKind = 'pipeline' | 'sdr';
export type NodeKind =
  | 'trigger' | 'condition' | 'intent_classifier' | 'knowledge_lookup' | 'ai_generate'
  | 'whatsapp_template' | 'whatsapp_reply' | 'email' | 'crm_stage_change' | 'crm_task'
  | 'crm_update' | 'billing_read' | 'wait' | 'human_handoff' | 'notify' | 'stop' | 'end';

export type FlowNode = {
  id: string;
  type: NodeKind;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  ports: string[];
  disabled?: boolean;
};
export type FlowEdge = {
  id: string;
  source: string;
  source_port: string;
  target: string;
  target_port: string;
  label?: string;
};
export type FlowDefinition = {
  schema_version: string;
  id: string;
  name: string;
  kind: FlowKind;
  status: 'draft' | 'published';
  version: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  description?: string;
  metadata?: Record<string, unknown>;
};
export type FlowIssue = { code: string; path: string; message: string };
export type FlowValidation = { ok: boolean; issues: FlowIssue[] };
export type FlowTrace = {
  nodeId: string;
  type: NodeKind;
  status: 'evaluated' | 'planned' | 'end';
  nextPort?: string;
};
export type FlowSimulation = { dryRun: true; trace: FlowTrace[]; issues: FlowIssue[] };

const KNOWN_TYPES: ReadonlySet<string> = new Set<NodeKind>([
  'trigger', 'condition', 'intent_classifier', 'knowledge_lookup', 'ai_generate',
  'whatsapp_template', 'whatsapp_reply', 'email', 'crm_stage_change', 'crm_task',
  'crm_update', 'billing_read', 'wait', 'human_handoff', 'notify', 'stop', 'end',
]);
const TERMINAL: ReadonlySet<string> = new Set(['end', 'stop']);
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
const validPort = (value: unknown) =>
  validId(value) && /^[a-z][a-z0-9_-]*$/i.test(value as string);
const validField = (value: unknown): value is string =>
  typeof value === 'string'
  && /^(opportunity|conversation|billing|lead|event)\.[a-z][a-z0-9_.]*$/i.test(value)
  && !value.split('.').some(part => ['__proto__', 'constructor', 'prototype'].includes(part));

/** Structural validation only: publication requires additional server-side policies. */
export function validateFlow(graph: unknown): FlowValidation {
  const issues: FlowIssue[] = [];
  const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
  if (!isObject(graph)) {
    return { ok: false, issues: [{ code: 'INVALID_GRAPH', path: '$', message: 'Grafo inválido.' }] };
  }
  if (!validId(graph.id) || !validId(graph.name)) {
    add('FLOW_IDENTITY', '$', 'ID e nome são obrigatórios.');
  }
  if (!['pipeline', 'sdr'].includes(String(graph.kind))) {
    add('FLOW_KIND', 'kind', 'Tipo de fluxo desconhecido.');
  }
  if (!['draft', 'published'].includes(String(graph.status))) {
    add('FLOW_STATUS', 'status', 'Estado desconhecido.');
  }
  if (!Number.isSafeInteger(graph.version) || Number(graph.version) < 1) {
    add('FLOW_VERSION', 'version', 'Versão inválida.');
  }
  if (typeof graph.schema_version !== 'string' || !graph.schema_version) {
    add('SCHEMA_VERSION', 'schema_version', 'Versão de schema obrigatória.');
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    add('FLOW_SHAPE', '$', 'Nós e conexões precisam ser listas.');
    return { ok: false, issues };
  }
  if (!graph.nodes.length) add('NO_NODES', 'nodes', 'Inclua ao menos um nó.');
  if (graph.nodes.length > 500 || graph.edges.length > 1000) {
    add('FLOW_TOO_LARGE', '$', 'Limites de tamanho excedidos.');
  }

  const nodes = new Map<string, FlowNode>();
  const edges = new Set<string>();
  let triggers = 0;
  let terminals = 0;
  graph.nodes.forEach((candidate, i) => {
    const path = 'nodes[' + i + ']';
    if (!isObject(candidate) || !validId(candidate.id)
      || !KNOWN_TYPES.has(String(candidate.type)) || !validId(candidate.label)
      || !isObject(candidate.position)
      || !Number.isFinite(candidate.position.x) || !Number.isFinite(candidate.position.y)
      || !isObject(candidate.config) || !Array.isArray(candidate.ports)
      || !candidate.ports.every(validPort)
      || new Set(candidate.ports).size !== candidate.ports.length) {
      add('INVALID_NODE', path, 'Nó, posição, configuração ou portas inválidas.');
      return;
    }
    const node = candidate as FlowNode;
    if (nodes.has(node.id)) add('DUPLICATE_NODE', path, 'ID de nó repetido.');
    nodes.set(node.id, node);
    if (node.type === 'trigger') {
      triggers++;
      if (!validId(node.config.event_type)) {
        add('TRIGGER_EVENT', path + '.config', 'Evento do gatilho é obrigatório.');
      }
    }
    if (TERMINAL.has(node.type)) terminals++;
    if (node.type === 'condition') {
      if (!validField(node.config.field)) {
        add('CONDITION_FIELD', path + '.config.field', 'Campo não permitido.');
      }
      const op = node.config.operator;
      if (op === 'eq' || op === 'neq') {
        if (!node.ports.includes('yes') || !node.ports.includes('no')) {
          add('CONDITION_PORTS', path, 'Condição precisa de portas yes/no.');
        }
      } else if (op === 'equals_any') {
        if (!Array.isArray(node.config.cases) || !node.config.cases.length
          || !node.config.cases.every(validPort) || !validPort(node.config.default)
          || ![...node.config.cases, node.config.default].every(port =>
            node.ports.includes(port as string))) {
          add('CONDITION_CASES', path, 'Ramos da condição inválidos.');
        }
      } else {
        add('CONDITION_OPERATOR', path, 'Operador não permitido.');
      }
    }
  });
  if (triggers !== 1) {
    add('TRIGGER_COUNT', 'nodes', 'O fluxo precisa de exatamente um gatilho.');
  }
  if (!terminals) add('TERMINAL_REQUIRED', 'nodes', 'É necessário um nó final.');

  const outgoing = new Map<string, FlowEdge[]>();
  graph.edges.forEach((candidate, i) => {
    const path = 'edges[' + i + ']';
    if (!isObject(candidate) || !validId(candidate.id) || !validId(candidate.source)
      || !validId(candidate.target) || !validPort(candidate.source_port)
      || !validPort(candidate.target_port)) {
      add('INVALID_EDGE', path, 'Conexão inválida.');
      return;
    }
    const edge = candidate as FlowEdge;
    if (edges.has(edge.id)) add('DUPLICATE_EDGE', path, 'ID de conexão repetido.');
    edges.add(edge.id);
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) add('ORPHAN_EDGE', path, 'Conexão referencia nó inexistente.');
    if (source && !source.ports.includes(edge.source_port)) {
      add('SOURCE_PORT', path, 'Porta de origem desconhecida.');
    }
    if (target && !target.ports.includes(edge.target_port)) {
      add('TARGET_PORT', path, 'Porta de destino desconhecida.');
    }
    if (target?.type === 'trigger') {
      add('TRIGGER_INCOMING', path, 'Gatilho não recebe conexões.');
    }
    if (source && TERMINAL.has(source.type)) {
      add('TERMINAL_OUTGOING', path, 'Nó final não pode apontar para outro.');
    }
    const list = outgoing.get(edge.source) || [];
    if (list.some(item => item.source_port === edge.source_port)) {
      add('AMBIGUOUS_PORT', path, 'Múltiplos caminhos para a mesma saída.');
    }
    outgoing.set(edge.source, [...list, edge]);
  });
  for (const node of nodes.values()) {
    const paths = outgoing.get(node.id) || [];
    if (!TERMINAL.has(node.type) && paths.length === 0) {
      add('DEAD_END', 'node:' + node.id, 'Nó sem saída.');
    }
    if (node.type === 'condition') {
      const required = node.config.operator === 'equals_any'
        ? [...(Array.isArray(node.config.cases) ? node.config.cases : []), node.config.default]
        : ['yes', 'no'];
      for (const port of required) {
        if (validPort(port) && !paths.some(edge => edge.source_port === port)) {
          add('UNCONNECTED_BRANCH', 'node:' + node.id, 'Ramo não conectado: ' + port);
        }
      }
    }
  }
  const starting = [...nodes.values()].filter(node => node.type === 'trigger');
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string) => {
    if (visiting.has(id)) {
      add('CYCLE', 'node:' + id, 'Ciclo de execução não permitido.');
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of outgoing.get(id) || []) {
      if (nodes.has(edge.target)) walk(edge.target);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const trigger of starting) walk(trigger.id);
  for (const node of nodes.values()) {
    if (!visited.has(node.id)) {
      add('UNREACHABLE_NODE', 'node:' + node.id, 'Nó desconectado do gatilho.');
    }
  }
  return { ok: issues.length === 0, issues };
}

function readField(context: Record<string, unknown>, path: string): unknown {
  if (!validField(path)) return undefined;
  let value: unknown = context;
  for (const segment of path.split('.')) {
    if (!isObject(value) || !Object.prototype.hasOwnProperty.call(value, segment)) {
      return undefined;
    }
    value = value[segment];
  }
  return value;
}

/** Preview only. Action adapters and external side effects are deliberately absent. */
export function simulateFlow(
  graph: FlowDefinition,
  input: { eventType: string; context: Record<string, unknown> },
): FlowSimulation {
  const validated = validateFlow(graph);
  if (!validated.ok) return { dryRun: true, trace: [], issues: validated.issues };
  const trace: FlowTrace[] = [];
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const trigger = graph.nodes.find(node => node.type === 'trigger')!;
  if (trigger.config.event_type !== input.eventType) {
    return {
      dryRun: true,
      trace,
      issues: [{
        code: 'EVENT_NOT_MATCHED',
        path: 'eventType',
        message: 'Evento não corresponde ao gatilho.',
      }],
    };
  }
  let current: FlowNode | undefined = trigger;
  for (let count = 0; count < graph.nodes.length && current; count++) {
    if (current.disabled) {
      return {
        dryRun: true, trace,
        issues: [{
          code: 'DISABLED_NODE',
          path: 'node:' + current.id,
          message: 'Nó desativado requer uma política de bypass explícita.',
        }],
      };
    }
    if (TERMINAL.has(current.type)) {
      trace.push({ nodeId: current.id, type: current.type, status: 'end' });
      return { dryRun: true, trace, issues: [] };
    }
    let nextPort = 'out';
    if (current.type === 'condition') {
      const actual = readField(input.context, current.config.field as string);
      if (current.config.operator === 'equals_any') {
        nextPort = (current.config.cases as string[]).some(test => test === actual)
          ? String(actual) : String(current.config.default);
      } else {
        const equal = actual === current.config.value;
        nextPort = (current.config.operator === 'eq' ? equal : !equal) ? 'yes' : 'no';
      }
    }
    trace.push({
      nodeId: current.id, type: current.type,
      status: current.type === 'condition' || current.type === 'trigger'
        ? 'evaluated' : 'planned',
      nextPort,
    });
    const edge = graph.edges.find(e =>
      e.source === current!.id && e.source_port === nextPort);
    if (!edge) {
      return {
        dryRun: true, trace,
        issues: [{
          code: 'MISSING_PATH',
          path: 'node:' + current.id,
          message: 'Saída sem conexão: ' + nextPort,
        }],
      };
    }
    current = nodes.get(edge.target);
  }
  return {
    dryRun: true, trace,
    issues: [{
      code: 'SIMULATION_LIMIT',
      path: '$',
      message: 'Limite de execução de simulação atingido.',
    }],
  };
}
