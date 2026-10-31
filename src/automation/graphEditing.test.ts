import { describe, expect, it } from 'vitest';
import { connectPorts, reconnectEdge, createHistory, insertNodeOnEdge, moveNode, recordEdit, redoEdit, removeNode, undoEdit, autoLayoutFlow } from './graphEditing';
import type { FlowDefinition, FlowNode } from './flowDefinition';

const graph: FlowDefinition = {
  id: 'test', name: 'Teste', kind: 'pipeline', version: 1, schema_version: '0.1-concept', status: 'draft',
  nodes: [
    { id: 'a', type: 'trigger', label: 'Início', position: { x: 0, y: 0 }, config: { event_type: 'opportunity.created' }, ports: ['out'] },
    { id: 'b', type: 'end', label: 'Fim', position: { x: 200, y: 0 }, config: {}, ports: ['in'] },
  ],
  edges: [{ id: 'e1', source: 'a', source_port: 'out', target: 'b', target_port: 'in', label: 'Rota original' }],
};
const newNode: FlowNode = { id: 'n1', type: 'crm_task', label: 'Criar tarefa', position: { x: 100, y: 0 }, config: { title: 'Atender' }, ports: ['in', 'out'] };

describe('non-emitting graph edit transactions', () => {
  it('moves a node without breaking or recreating edges', () => {
    const result = moveNode(graph, 'a', { x: 70, y: 40 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.graph.nodes[0].position).toEqual({ x: 70, y: 40 });
      expect(result.graph.edges).toEqual(graph.edges);
      expect(graph.nodes[0].position).toEqual({ x: 0, y: 0 });
    }
  });
  it('splits edge A→B into A→N→B and preserves original branch label', () => {
    const result = insertNodeOnEdge(graph, 'e1', newNode, 'out', 'e2');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.graph.edges).toEqual([
        { id: 'e1', source: 'a', source_port: 'out', target: 'n1', target_port: 'in', label: 'Rota original' },
        { id: 'e2', source: 'n1', source_port: 'out', target: 'b', target_port: 'in' },
      ]);
    }
    expect(graph.edges).toHaveLength(1);
  });
  it('rejects malformed splits without changing the graph', () => {
    expect(insertNodeOnEdge(graph, 'e1', { ...newNode, ports: ['in'] }, 'out', 'e2')).toEqual({ ok: false, code: 'NODE_NOT_INSERTABLE' });
    expect(insertNodeOnEdge(graph, 'missing', newNode, 'out', 'e2')).toEqual({ ok: false, code: 'EDGE_UNKNOWN' });
    expect(insertNodeOnEdge(graph, 'e1', newNode, 'out', 'e1')).toEqual({ ok: false, code: 'ID_COLLISION' });
  });
  it('prevents cycles, double routes from one source port and terminal outgoing edges', () => {
    const graph2 = { ...graph, nodes: [graph.nodes[0], newNode, graph.nodes[1]], edges: [
      { id: 'e1', source: 'a', source_port: 'out', target: 'n1', target_port: 'in' },
      { id: 'e2', source: 'n1', source_port: 'out', target: 'b', target_port: 'in' },
    ] };
    expect(connectPorts(graph2, { id: 'e3', source: 'n1', source_port: 'out', target: 'a', target_port: 'out' })).toEqual({ ok: false, code: 'TRIGGER_INCOMING' });
    expect(connectPorts(graph2, { id: 'e3', source: 'n1', source_port: 'out', target: 'b', target_port: 'in' })).toEqual({ ok: false, code: 'SOURCE_ALREADY_CONNECTED' });
    expect(connectPorts(graph2, { id: 'e3', source: 'b', source_port: 'in', target: 'n1', target_port: 'in' })).toEqual({ ok: false, code: 'TERMINAL_OUTGOING' });
  });
  it('reconnects existing edge while keeping its ID and forbids invalid target ports', () => {
    const changed = reconnectEdge(graph, 'e1', 'b', 'out');
    expect(changed).toEqual({ ok: false, code: 'PORT_UNKNOWN' });
    const enriched = {
      ...graph,
      nodes: [...graph.nodes, { id: 'c', type: 'end' as const, label: 'Alternate finish',
        position: { x: 500, y: 100 }, ports: ['in'], config: {} }],
    };
    const replaced = reconnectEdge(enriched, 'e1', 'c');
    expect(replaced.ok).toBe(true);
    if (replaced.ok) {
      expect(replaced.graph.edges[0]).toMatchObject({
        id: 'e1', source: 'a', target: 'c', label: 'Rota original',
      });
    }
    expect(graph.edges[0].target).toBe('b');
    expect(reconnectEdge(enriched, 'e1', 'a')).toEqual({ ok: false, code: 'PORT_UNKNOWN' });
  });
  it('supports undo and redo without losing the initial graph', () => {
    const original = createHistory(graph);
    const changed = recordEdit(original, moveNode(graph, 'a', { x: 45, y: 90 }));
    expect(changed.graph.nodes[0].position.x).toBe(45);
    expect(undoEdit(changed).graph).toEqual(graph);
    expect(redoEdit(undoEdit(changed)).graph).toEqual(changed.graph);
    expect(undoEdit(original)).toBe(original);
    expect(recordEdit(original, { ok: false, code: 'DENIED' })).toBe(original);
  });
  it('refuses to delete the only trigger and removes disconnected edges atomically', () => {
    expect(removeNode(graph, 'a')).toEqual({ ok: false, code: 'TRIGGER_REQUIRED' });
    const inserted = insertNodeOnEdge(graph, 'e1', newNode, 'out', 'e2');
    if (!inserted.ok) throw Error('setup failed');
    const result = removeNode(inserted.graph, 'n1');
    if (!result.ok) throw Error('remove failed');
    expect(result.graph.nodes.map(n => n.id)).toEqual(['a', 'b']);
    expect(result.graph.edges).toEqual([]);
  });
});

describe('deterministic graph auto-layout',()=>{
  it('positions nodes according to dependencies without altering any edge or action configuration',()=>{
    const g={...graph,nodes:[...graph.nodes,newNode],edges:[
      {id:'a1',source:'a',source_port:'out',target:'n1',target_port:'in'},
      {id:'a2',source:'n1',source_port:'out',target:'b',target_port:'in'},
    ]};
    const changed=autoLayoutFlow(g);
    expect(changed.ok).toBe(true);
    if(!changed.ok)return;
    const x=Object.fromEntries(changed.graph.nodes.map(n=>[n.id,n.position.x]));
    expect(x.a).toBeLessThan(x.n1);
    expect(x.n1).toBeLessThan(x.b);
    expect(changed.graph.edges).toEqual(g.edges);
    expect(changed.graph.nodes.map(n=>n.config)).toEqual(g.nodes.map(n=>n.config));
    expect(changed.graph.nodes.map(n=>n.ports)).toEqual(g.nodes.map(n=>n.ports));
    expect(g.nodes[0].position.x).toBe(0);
    const again=autoLayoutFlow(changed.graph);
    expect(again.ok).toBe(true);
    if(again.ok)expect(again.graph).toEqual(changed.graph);
    const history=recordEdit(createHistory(g),changed);
    expect(undoEdit(history).graph).toEqual(g);
    expect(redoEdit(undoEdit(history)).graph).toEqual(changed.graph);
  });
  it('refuses cyclic and orphaned graphs without changing the original',()=>{
    const cycle={...graph,edges:[...graph.edges,{
      id:'a2',source:'b',source_port:'out',target:'a',target_port:'in'}]};
    expect(autoLayoutFlow(cycle)).toEqual({ok:false,code:'LAYOUT_CYCLE'});
    const orphan={...graph,edges:[{...graph.edges[0],target:'missing'}]};
    expect(autoLayoutFlow(orphan)).toEqual({ok:false,code:'LAYOUT_ORPHAN'});
    expect(graph.edges).toHaveLength(1);
  });
});
