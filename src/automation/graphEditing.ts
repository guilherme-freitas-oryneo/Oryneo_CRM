/** Immutable draft editor commands. No storage, network or external actions. */
import type { FlowDefinition, FlowEdge, FlowNode } from './flowDefinition';

export type EditResult = { ok: true; graph: FlowDefinition } | { ok: false; code: string };
export type DraftHistory = { graph: FlowDefinition; undo: FlowDefinition[]; redo: FlowDefinition[] };
const unchanged = (code: string): EditResult => ({ ok: false, code });
const duplicate = (graph: FlowDefinition, id: string) =>
  graph.nodes.some(node => node.id === id) || graph.edges.some(edge => edge.id === id);
const hasCycle = (graph: FlowDefinition): boolean => {
  const connected = new Map<string, string[]>();
  for (const edge of graph.edges) connected.set(edge.source, [...(connected.get(edge.source) || []), edge.target]);
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (done.has(node)) return false;
    visiting.add(node);
    if ((connected.get(node) || []).some(visit)) return true;
    visiting.delete(node);
    done.add(node);
    return false;
  };
  return graph.nodes.some(node => visit(node.id));
};
function connectable(graph: FlowDefinition, edge: FlowEdge): string | null {
  const source = graph.nodes.find(node => node.id === edge.source);
  const target = graph.nodes.find(node => node.id === edge.target);
  if (!source || !target) return 'NODE_UNKNOWN';
  if (!source.ports.includes(edge.source_port) || !target.ports.includes(edge.target_port)) return 'PORT_UNKNOWN';
  if (target.type === 'trigger') return 'TRIGGER_INCOMING';
  if (source.type === 'end' || source.type === 'stop') return 'TERMINAL_OUTGOING';
  if (source.id === target.id) return 'CYCLE';
  if (graph.edges.some(existing => existing.source === edge.source && existing.source_port === edge.source_port)) {
    return 'SOURCE_ALREADY_CONNECTED';
  }
  return null;
}
export function moveNode(graph: FlowDefinition, nodeId: string, position: { x: number; y: number }): EditResult {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return unchanged('POSITION_INVALID');
  if (!graph.nodes.some(node => node.id === nodeId)) return unchanged('NODE_UNKNOWN');
  return { ok: true, graph: {
    ...graph, nodes: graph.nodes.map(node => node.id === nodeId ? { ...node, position: { ...position } } : node),
  } };
}
export function connectPorts(graph: FlowDefinition, edge: FlowEdge): EditResult {
  if (!edge.id || duplicate(graph, edge.id)) return unchanged('EDGE_ID_COLLISION');
  const problem = connectable(graph, edge);
  if (problem) return unchanged(problem);
  const changed = { ...graph, edges: [...graph.edges, { ...edge }] };
  if (hasCycle(changed)) return unchanged('CYCLE');
  return { ok: true, graph: changed };
}
/** Atomically split an edge without dropping its original source and target semantics. */
export function insertNodeOnEdge(
  graph: FlowDefinition, edgeId: string, node: FlowNode, exitPort: string, newEdgeId: string,
): EditResult {
  const existing = graph.edges.find(edge => edge.id === edgeId);
  if (!existing) return unchanged('EDGE_UNKNOWN');
  if (!node.id || duplicate(graph, node.id) || !newEdgeId || duplicate(graph, newEdgeId)
    || node.id === newEdgeId) return unchanged('ID_COLLISION');
  if (!node.ports.includes('in') || !node.ports.includes(exitPort) || exitPort === 'in'
    || node.type === 'trigger' || node.type === 'end' || node.type === 'stop') {
    return unchanged('NODE_NOT_INSERTABLE');
  }
  const source = graph.nodes.find(item => item.id === existing.source);
  const target = graph.nodes.find(item => item.id === existing.target);
  if (!source || !target) return unchanged('EDGE_ORPHAN');
  const incoming: FlowEdge = { ...existing, target: node.id, target_port: 'in' };
  const outgoing: FlowEdge = {
    id: newEdgeId, source: node.id, source_port: exitPort,
    target: existing.target, target_port: existing.target_port,
  };
  const changed = {
    ...graph,
    nodes: [...graph.nodes, { ...node, position: { ...node.position }, config: { ...node.config }, ports: [...node.ports] }],
    edges: graph.edges.flatMap(edge => edge.id === edgeId ? [incoming, outgoing] : [edge]),
  };
  if (hasCycle(changed)) return unchanged('CYCLE');
  return { ok: true, graph: changed };
}
export function removeNode(graph: FlowDefinition, nodeId: string): EditResult {
  const node = graph.nodes.find(item => item.id === nodeId);
  if (!node) return unchanged('NODE_UNKNOWN');
  if (node.type === 'trigger') return unchanged('TRIGGER_REQUIRED');
  return { ok: true, graph: {
    ...graph, nodes: graph.nodes.filter(item => item.id !== nodeId),
    edges: graph.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId),
  } };
}
export function createHistory(graph: FlowDefinition): DraftHistory {
  return { graph, undo: [], redo: [] };
}
export function recordEdit(history: DraftHistory, change: EditResult): DraftHistory {
  if (!change.ok) return history;
  return { graph: change.graph, undo: [...history.undo.slice(-49), history.graph], redo: [] };
}
export function undoEdit(history: DraftHistory): DraftHistory {
  if (!history.undo.length) return history;
  return {
    graph: history.undo[history.undo.length - 1],
    undo: history.undo.slice(0, -1),
    redo: [history.graph, ...history.redo].slice(0, 50),
  };
}
export function redoEdit(history: DraftHistory): DraftHistory {
  if (!history.redo.length) return history;
  return {
    graph: history.redo[0],
    undo: [...history.undo.slice(-49), history.graph],
    redo: history.redo.slice(1),
  };
}
