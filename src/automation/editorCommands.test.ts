import {describe,it,expect} from 'vitest';
import {createHistory,recordEdit,undoEdit,redoEdit} from './graphEditing';
import {importDraftJson,duplicateDraftNode,removeEdgeById,moveSelectedNodes,removeSelectedNodes,fitGraphView,viewportToGraph,routeBranchLabel} from './editorCommands';
import type {FlowDefinition} from './flowDefinition';
const g=():FlowDefinition=>({
 schema_version:'1.0.0',id:'flow',name:'Processo SDR',kind:'sdr',status:'draft',version:3,
 nodes:[
  {id:'a',type:'trigger',label:'Entrada',ports:['out'],config:{event_type:'conversation.inbound'},position:{x:20,y:20}},
  {id:'b',type:'condition',label:'Condição',ports:['in','yes','no'],config:{rule:{kind:'compare',field:'conversation.mode',op:'eq',value:'sdr_active'}},position:{x:300,y:80}},
  {id:'c',type:'end',label:'Fim',ports:['in'],config:{},position:{x:660,y:80}},
  {id:'d',type:'stop',label:'Cancelar',ports:['in'],config:{},position:{x:660,y:250}},
 ],
 edges:[
  {id:'e1',source:'a',source_port:'out',target:'b',target_port:'in'},
  {id:'e2',source:'b',source_port:'yes',target:'c',target_port:'in',label:'Sim'},
  {id:'e3',source:'b',source_port:'no',target:'d',target_port:'in',label:'Não'},
 ]});
describe('oryneo visual editor pure commands: no provider side effects',()=>{
 it('moves multiple nodes in ONE undo/redo transaction, keeping every edge and config immutable',()=>{
  const original=g();const moved=moveSelectedNodes(original,['b','c'],45,30);
  expect(moved.ok).toBe(true);
  if(!moved.ok)return;
  expect(moved.graph.edges).toEqual(original.edges);
  expect(moved.graph.nodes[1].config).toEqual(original.nodes[1].config);
  expect(moved.graph.nodes[1].position).toEqual({x:345,y:110});
  expect(moved.graph.nodes[2].position).toEqual({x:705,y:110});
  const edit=recordEdit(createHistory(original),moved);
  expect(undoEdit(edit).graph).toEqual(original);
  expect(redoEdit(undoEdit(edit)).graph).toEqual(moved.graph);
 });
 it('removes selected non-trigger nodes and their edges atomically; protects unique trigger',()=>{
  const original=g();expect(removeSelectedNodes(original,['a']).ok).toBe(false);
  const removed=removeSelectedNodes(original,['b','d']);
  expect(removed.ok).toBe(true);if(!removed.ok)return;
  expect(removed.graph.nodes.map(n=>n.id)).toEqual(['a','c']);
  expect(removed.graph.edges).toEqual([]);
  expect(original.nodes).toHaveLength(4);
 });
 it('duplicates selected node without accidentally inheriting graph connections',()=>{
  const duplicate=duplicateDraftNode(g(),'b','e');
  expect(duplicate.ok).toBe(true);if(!duplicate.ok)return;
  expect(duplicate.graph.edges).toHaveLength(3);
  expect(duplicate.graph.nodes.at(-1)?.type).toBe('condition');
  expect(duplicate.graph.nodes.at(-1)?.config).toEqual(g().nodes[1].config);
  expect(duplicateDraftNode(g(),'a','z').ok).toBe(false);
 });
 it('removes selected edge only and leaves graph node identities intact',()=>{
  const removed=removeEdgeById(g(),'e2');
  expect(removed.ok).toBe(true);if(!removed.ok)return;
  expect(removed.graph.edges.map(e=>e.id)).toEqual(['e1','e3']);
  expect(removed.graph.nodes).toEqual(g().nodes);
 });
 it('imports valid flow as a completely new draft with remapped edges and typed kind',()=>{
  const before=g();
  const parsed=importDraftJson(JSON.stringify(before),'sdr');
  expect(parsed.ok).toBe(true);if(!parsed.ok)return;
  expect(parsed.graph.status).toBe('draft');
  expect(parsed.graph.version).toBe(1);
  expect(parsed.graph.id).not.toBe(before.id);
  expect(parsed.graph.nodes.map(n=>n.id)).not.toContain('a');
  expect(parsed.graph.edges[0].source).toBe(parsed.graph.nodes[0].id);
  expect(parsed.graph.edges[0].target).toBe(parsed.graph.nodes[1].id);
  expect(parsed.graph.edges[1].label).toBe('Sim');
  expect(importDraftJson(JSON.stringify(before),'pipeline')).toEqual({ok:false,code:'IMPORT_KIND_MISMATCH'});
 });
 it('rejects malicious keys, invalid cycles, unbounded JSON and unpublished side effects',()=>{
  expect(importDraftJson('not json','sdr').ok).toBe(false);
  expect(importDraftJson('{"__proto__":{"admin":true}}','sdr').ok).toBe(false);
  expect(importDraftJson(JSON.stringify({...g(),nodes:g().nodes.map(n=>({...n,config:{constructor:'x'}}))}),'sdr').ok).toBe(false);
  expect(importDraftJson('x'.repeat(251_000),'sdr').ok).toBe(false);
  expect(importDraftJson(JSON.stringify({...g(),edges:[...g().edges,{id:'evil',source:'d',source_port:'out',target:'a',target_port:'in'}]}),'sdr').ok).toBe(false);
 });
 it('calculates zoom-to-fit para fluxos grandes e coordenadas com zoom/pan',()=>{
  const visible=fitGraphView(g().nodes,{width:900,height:540});
  expect(visible.zoom).toBeGreaterThan(0.4);
  expect(visible.zoom).toBeLessThanOrEqual(1.5);
  expect(viewportToGraph({x:150,y:160},{left:50,top:60},{left:100,top:40},2)).toEqual({x:100,y:70});
  expect(routeBranchLabel('yes')).toBe('Sim');
  expect(routeBranchLabel('timeout')).toBe('Tempo esgotado');
 });
});
