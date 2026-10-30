import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AlertCircle, ArrowRight, BookOpen, CirclePlay, Clock3, FileJson, GitBranch, History, Layers3, LockKeyhole, Plus, Redo2, Search, Settings2, ShieldCheck, Undo2, Workflow, X, ZoomIn, ZoomOut } from 'lucide-react';
import { connectPorts, createHistory, insertNodeOnEdge, moveNode, recordEdit, redoEdit, removeNode, undoEdit, type DraftHistory } from './graphEditing';
import { nodePalette, NODE_REGISTRY, type NodeFamily } from './nodeRegistry';
import { simulateFlow, validateFlow, type FlowDefinition, type FlowKind, type FlowNode, type NodeKind } from './flowDefinition';
import './automations-workspace.css';

type Tab = 'overview' | 'pipeline' | 'sdr' | 'triggers' | 'templates' | 'executions';
const TABS: { key: Tab; label: string; icon: typeof Workflow }[] = [
  { key: 'overview', label: 'Visão geral', icon: Layers3 },
  { key: 'pipeline', label: 'Fluxos do pipeline', icon: Workflow },
  { key: 'sdr', label: 'Fluxos do SDR', icon: GitBranch },
  { key: 'triggers', label: 'Gatilhos e condições', icon: Settings2 },
  { key: 'templates', label: 'Templates e canais', icon: BookOpen },
  { key: 'executions', label: 'Execuções e diagnóstico', icon: History },
];
const NAMES: Record<NodeFamily, string> = {
  trigger: 'Gatilhos', logic: 'Condições', intelligence: 'Inteligência',
  communication: 'Comunicação', crm: 'CRM', control: 'Controle',
};
const defaultConfig = (type: NodeKind, kind: FlowKind): Record<string, unknown> => {
  switch (type) {
    case 'trigger': return { event_type: kind === 'sdr' ? 'conversation.inbound' : 'opportunity.created' };
    case 'condition': return { rule: { kind: 'compare', field: 'conversation.mode', op: 'eq', value: 'sdr_active' } };
    case 'wait': return { duration_minutes: 60, cancel_on_reply: true };
    case 'crm_task': return { title: 'Verificar oportunidade', due_offset_minutes: 60 };
    case 'human_handoff': return { reason_code: 'manual_review' };
    case 'notify': return { event_code: 'review_needed' };
    case 'ai_generate': return { prompt_ref: 'aguardando_homologacao', max_tokens: 400 };
    case 'whatsapp_template': return { template_registry_id: '', locale: 'pt_BR' };
    case 'whatsapp_reply': return { text_ref: '' };
    case 'knowledge_lookup': return { knowledge_release_id: '' };
    case 'intent_classifier': return { dictionary_release_id: '', min_confidence: 0.8 };
    case 'crm_stage_change': return { target_stage_id: '' };
    case 'crm_update': return { allowed_field: 'notes', value_ref: '' };
    case 'email': return { template_id: '', recipient_field: 'lead.email' };
    default: return {};
  }
};
const makeDraft = (kind: FlowKind): FlowDefinition => {
  const id = crypto.randomUUID();
  return {
    schema_version: '0.1-concept', id, name: kind === 'sdr' ? 'Novo fluxo SDR' : 'Novo fluxo do pipeline',
    kind, status: 'draft', version: 1,
    nodes: [
      { id: crypto.randomUUID(), type: 'trigger', label: 'Gatilho inicial', position: { x: 100, y: 150 },
        config: defaultConfig('trigger', kind), ports: ['out'] },
      { id: crypto.randomUUID(), type: 'end', label: 'Fim', position: { x: 560, y: 150 },
        config: {}, ports: ['in'] },
    ],
    edges: [],
  };
};
function connectedDraft(kind: FlowKind) {
  const draft = makeDraft(kind);
  draft.edges = [{
    id: crypto.randomUUID(), source: draft.nodes[0].id,
    source_port: 'out', target: draft.nodes[1].id, target_port: 'in',
  }];
  return draft;
}
function safeRead(storageKey: string): FlowDefinition[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((graph): graph is FlowDefinition => {
      if (!graph || typeof graph !== 'object' || graph.status !== 'draft'
        || !['pipeline','sdr'].includes(String(graph.kind))
        || typeof graph.id !== 'string' || graph.id.length > 128
        || typeof graph.name !== 'string' || graph.name.length > 160
        || !Array.isArray(graph.nodes) || graph.nodes.length > 500
        || !Array.isArray(graph.edges) || graph.edges.length > 1000) return false;
      // Incomplete drafts must survive a reload. Validation is shown separately.
      return graph.nodes.every((node: FlowNode) => node
        && typeof node.id === 'string' && node.position
        && Number.isFinite(node.position.x) && Number.isFinite(node.position.y)
        && node.config && typeof node.config === 'object' && !Array.isArray(node.config)
        && Array.isArray(node.ports) && Object.prototype.hasOwnProperty.call(NODE_REGISTRY, node.type));
    }).slice(0, 30);
  } catch { return []; }
}

function useDrafts(userId: string) {
  const key = 'oryneo:automations:draft:' + userId;
  const [drafts, setDrafts] = useState<FlowDefinition[]>(() => safeRead(key));
  const [dirtyError, setDirtyError] = useState('');
  const save = (next: FlowDefinition[]) => {
    if (next.length > 30) { setDirtyError('Máximo de 30 rascunhos locais.'); return false; }
    try {
      const json = JSON.stringify(next);
      if (json.length > 500_000) { setDirtyError('Rascunhos excedem o limite local.'); return false; }
      localStorage.setItem(key, json);
      setDrafts(next);
      setDirtyError('');
      return true;
    } catch {
      setDirtyError('Armazenamento local indisponível. Exporte seu rascunho para não perdê-lo.');
      return false;
    }
  };
  return { drafts, save, dirtyError };
}

export function AutomationsWorkspace({ userId }: { userId: string }) {
  const [tab, setTab] = useState<Tab>('overview');
  const { drafts, save, dirtyError } = useDrafts(userId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<DraftHistory | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeEdge, setActiveEdge] = useState<string | null>(null);
  const [sourcePort, setSourcePort] = useState<{ nodeId: string; port: string } | null>(null);
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<ReturnType<typeof simulateFlow> | null>(null);
  const [jsonConfig, setJsonConfig] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; edgeId: string | null } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; nodeId: string; originX: number; originY: number; startX: number; startY: number } | null>(null);
  const current = history?.graph;
  const selected = current?.nodes.find(node => node.id === selectedId) || null;
  const validation = useMemo(() => current ? validateFlow(current) : null, [current]);
  const commit = (change: ReturnType<typeof moveNode>) => {
    if (!history) return;
    if (!change.ok) { setNotice('A operação não foi aplicada: ' + change.code); return; }
    setHistory(recordEdit(history, change));
    setPreview(null);
    setNotice('Alterações no rascunho. Salve para manter neste dispositivo.');
  };
  const open = (graph: FlowDefinition) => {
    setTab(graph.kind);
    setOpenId(graph.id); setHistory(createHistory(graph));
    setSelectedId(null); setActiveEdge(null); setPreview(null);
    setNotice('Editor isolado: nenhum fluxo está conectado a disparos reais.');
  };
  const create = (kind: FlowKind) => open(connectedDraft(kind));
  const saveDraft = () => {
    if (!current) return;
    const next = drafts.filter(d => d.id !== current.id).concat(current);
    if (save(next)) setNotice('Rascunho salvo apenas neste navegador, sem publicação ou envio.');
  };
  const exportDraft = () => {
    if (!current) return;
    const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'oryneo-fluxo-' + current.kind + '.json'; link.click();
    URL.revokeObjectURL(url);
  };
  const addToEdge = (edgeId: string, type: NodeKind) => {
    if (!current || !history || ['trigger','stop','end'].includes(type)) return;
    const selectedEdge = current.edges.find(e => e.id === edgeId);
    if (!selectedEdge) return;
    const src = current.nodes.find(n => n.id === selectedEdge.source);
    const dst = current.nodes.find(n => n.id === selectedEdge.target);
    const descriptor = NODE_REGISTRY[type];
    const node: FlowNode = {
      id: crypto.randomUUID(), type, label: descriptor.title,
      position: {
        x: ((src?.position.x || 0) + (dst?.position.x || 0)) / 2,
        y: ((src?.position.y || 0) + (dst?.position.y || 0)) / 2 + 95,
      },
      ports: [...(descriptor.input ? ['in'] : []), ...descriptor.outputs],
      config: defaultConfig(type, current.kind),
    };
    const candidate = insertNodeOnEdge(current, edgeId, node, descriptor.outputs.includes('out') ? 'out' : descriptor.outputs[0], crypto.randomUUID());
    commit(candidate);
    if (candidate.ok) { setSelectedId(node.id); setJsonConfig(JSON.stringify(node.config, null, 2)); setActiveEdge(null); }
  };
  const onNodePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, node: FlowNode) => {
    if (event.button !== 0) return;
    pointer.current = { id: event.pointerId, nodeId: node.id, originX: event.clientX, originY: event.clientY, startX: node.position.x, startY: node.position.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onNodePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const p = pointer.current;
    if (!p || !current || p.id !== event.pointerId) return;
    pointer.current = null;
    const dx = (event.clientX - p.originX) / zoom, dy = (event.clientY - p.originY) / zoom;
    if (Math.abs(dx) + Math.abs(dy) > 3) commit(moveNode(current, p.nodeId, { x: Math.max(12,p.startX+dx), y: Math.max(12,p.startY+dy) }));
  };
  const showNode = (node: FlowNode) => {
    if (sourcePort && current && sourcePort.nodeId !== node.id) {
      const edge = {
        id: crypto.randomUUID(), source: sourcePort.nodeId, source_port: sourcePort.port, target: node.id, target_port: 'in',
      };
      commit(connectPorts(current, edge));
      setSourcePort(null); return;
    }
    setSelectedId(node.id); setActiveEdge(null); setJsonConfig(JSON.stringify(node.config, null, 2));
  };
  const applyJsonConfig = () => {
    if (!current || !selected) return;
    try {
      const cfg: unknown = JSON.parse(jsonConfig);
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('INVALID_CONFIG');
      const next = current.nodes.map(node =>
        node.id === selected.id ? { ...node, config: cfg as Record<string, unknown> } : node);
      commit({ ok: true, graph: { ...current, nodes: next } });
    } catch {
      setNotice('JSON inválido: o nó não foi alterado.');
    }
  };
  const fit = () => setZoom(1);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!history) return;
      if ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); setHistory(h => h ? (event.shiftKey ? redoEdit(h) : undoEdit(h)) : null);
      }
      if (event.key === 'Escape') { setSourcePort(null); setMenu(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [history]);
  const subviews: Record<Exclude<Tab,'pipeline'|'sdr'>, { title: string; description: string }> = {
    overview: { title: 'Orquestração comercial', description: 'Centralize seus fluxos e acompanhe a transição para o novo motor com segurança.' },
    triggers: { title: 'Gatilhos e condições', description: 'Biblioteca de regras tipadas. Condições editáveis exigem confirmação do backend.' },
    templates: { title: 'Templates e canais', description: 'Os modelos precisam ser sincronizados com a Meta antes de qualquer envio.' },
    executions: { title: 'Execuções e diagnóstico', description: 'A nova engine ainda não está habilitada. As execuções legadas permanecem no sistema atual.' },
  };
  const displayBuilder = current && (tab === 'pipeline' || tab === 'sdr') && current.kind === tab;
  return (
    <div className="ory-auto" aria-label="Centro de Automações" data-open-flow={openId||undefined}>
      <div className="ory-auto-header">
        <div><span className="ory-auto-overline">ORYNEO / OPERAÇÃO</span><h1>Automações</h1><p>Fluxos inteligentes, com controle humano e rastreabilidade.</p></div>
        <span className="ory-auto-safe"><LockKeyhole size={14}/> Ambiente de preparação</span>
      </div>
      <nav className="ory-auto-tabs" aria-label="Áreas de automações">
        {TABS.map(item => <button key={item.key} type="button" className={tab===item.key?'active':''} onClick={() => {
          setTab(item.key); setMenu(null); setSourcePort(null); if (item.key !== 'pipeline' && item.key !== 'sdr') setOpenId(null);
        }}><item.icon size={15}/>{item.label}</button>)}
      </nav>
      {dirtyError && <div role="alert" className="ory-auto-warning"><AlertCircle size={15}/>{dirtyError}</div>}
      {(tab === 'pipeline' || tab === 'sdr') && !displayBuilder && <div className="ory-auto-list">
        <div className="ory-auto-list-heading">
          <div><span className="ory-auto-overline">BIBLIOTECA DE FLUXOS</span><h2>{tab === 'sdr' ? 'Fluxos conversacionais SDR' : 'Fluxos do pipeline'}</h2><p>Rascunhos locais e não publicados. Os disparos atuais permanecem no motor existente.</p></div>
          <button className="ory-auto-primary" onClick={()=>create(tab)}><Plus size={17}/> Novo fluxo</button>
        </div>
        <div className="ory-auto-flows">
          {drafts.filter(g=>g.kind===tab).map(flow=><button className="ory-auto-flow-card" key={flow.id} onClick={()=>open(flow)}>
            <span className="ory-auto-flow-icon"><Workflow size={21}/></span>
            <span><strong>{flow.name}</strong><small>{flow.nodes.length} nós · {flow.edges.length} conexões · rascunho local</small></span><ArrowRight size={17}/>
          </button>)}
          <button className="ory-auto-flow-card ory-auto-create-card" onClick={()=>create(tab)}><Plus size={21}/><span><strong>Criar fluxo</strong><small>Começar com gatilho e conclusão conectados</small></span></button>
        </div>
      </div>}
      {displayBuilder && <div className="ory-auto-editor">
        <div className="ory-auto-editor-toolbar">
          <div className="ory-auto-editor-name"><button aria-label="Voltar à lista" onClick={()=>{setOpenId(null);setHistory(null)}}><ArrowRight size={17} style={{transform:'rotate(180deg)'}}/></button>
            <input aria-label="Nome do fluxo" value={current.name} maxLength={160} onChange={e => commit({ok:true,graph:{...current,name:e.target.value}})}/><span className="ory-auto-draft">RASCUNHO · V{current.version}</span>
          </div>
          <div className="ory-auto-editor-actions">
            <button title="Desfazer" onClick={()=>setHistory(h=>h?undoEdit(h):h)} disabled={!history?.undo.length}><Undo2 size={16}/></button>
            <button title="Refazer" onClick={()=>setHistory(h=>h?redoEdit(h):h)} disabled={!history?.redo.length}><Redo2 size={16}/></button>
            <button title="Validar grafo" onClick={()=>setNotice(validation?.ok?'Grafo estruturalmente válido. Ainda requer homologação no servidor.':(validation?.issues||[]).map(x=>x.code).join(' · '))}><ShieldCheck size={16}/>Validar</button>
            <button title="Simular sem efeitos externos" onClick={()=>{
              setPreview(simulateFlow(current,{eventType:String(current.nodes.find(n=>n.type==='trigger')?.config.event_type||''),context:{}}));
            }}><CirclePlay size={16}/>Simular</button>
            <button title="Exportar rascunho em JSON" onClick={exportDraft}><FileJson size={16}/></button>
            <button className="ory-auto-primary" onClick={saveDraft}>Salvar rascunho</button>
            <button title="Publicação disponível após engine homologada" disabled>Publicar <LockKeyhole size={13}/></button>
          </div>
        </div>
        <div className="ory-auto-editor-main">
          <aside className="ory-auto-palette"><h3>Biblioteca de nós</h3><label className="ory-auto-palette-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar bloco"/></label>
            {([...new Set(nodePalette(current.kind).map(x=>x.descriptor.family))] as NodeFamily[]).map(family=><div className="ory-auto-palette-group" key={family}><h4>{NAMES[family]}</h4>
              {nodePalette(current.kind).filter(x=>x.descriptor.family===family && x.descriptor.title.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).map(({type,descriptor})=>
                <button key={type} disabled={!activeEdge || ['trigger','end','stop'].includes(type)} title={activeEdge?'Inserir bloco na conexão selecionada':'Selecione uma conexão no canvas para inserir o bloco'} onClick={()=>activeEdge&&addToEdge(activeEdge,type)}>
                  <span className={'ory-auto-palette-dot family-'+family}/>{descriptor.title}<Plus size={13}/>
                </button>)}</div>)}
          </aside>
          <div className="ory-auto-canvas-scroll" ref={stage} onContextMenu={e=>{if(e.target===e.currentTarget){e.preventDefault();setMenu({x:e.clientX,y:e.clientY,edgeId:null})}}}>
            <div className="ory-auto-canvas" style={{transform:'scale('+zoom+')',transformOrigin:'top left'}}>
              <svg aria-hidden="true" className="ory-auto-connections" viewBox="0 0 1500 950" preserveAspectRatio="none">
                {current.edges.map(edge=>{
                  const src=current.nodes.find(n=>n.id===edge.source),dst=current.nodes.find(n=>n.id===edge.target);if(!src||!dst)return null;
                  const x1=src.position.x+220,y1=src.position.y+43,x2=dst.position.x,y2=dst.position.y+43;
                  return <path key={edge.id} d={'M'+x1+' '+y1+' C'+(x1+90)+' '+y1+' '+(x2-90)+' '+y2+' '+x2+' '+y2} className={activeEdge===edge.id?'selected':''}/>;
                })}
              </svg>
              {current.edges.map(edge=>{
                const src=current.nodes.find(n=>n.id===edge.source),dst=current.nodes.find(n=>n.id===edge.target);if(!src||!dst)return null;
                const x=(src.position.x+220+dst.position.x)/2,y=(src.position.y+dst.position.y)/2+43;
                return <button key={edge.id} className={'ory-auto-edge-add'+(activeEdge===edge.id?' active':'')} style={{left:x,top:y}} aria-label="Selecionar conexão para inserir nó" title="Inserir bloco nesta conexão" onClick={()=>{setActiveEdge(edge.id);setSelectedId(null)}} onContextMenu={e=>{e.preventDefault();setActiveEdge(edge.id);setMenu({x:e.clientX,y:e.clientY,edgeId:edge.id})}}><Plus size={13}/></button>;
              })}
              {current.nodes.map(node=><div className={'ory-auto-node family-'+NODE_REGISTRY[node.type].family+(selectedId===node.id?' selected':'')+(node.disabled?' disabled':'')} key={node.id} style={{left:node.position.x,top:node.position.y}}>
                <button className="ory-auto-node-body" onClick={()=>showNode(node)} onPointerDown={e=>onNodePointerDown(e,node)} onPointerUp={onNodePointerUp} onContextMenu={e=>{e.preventDefault();showNode(node);setMenu({x:e.clientX,y:e.clientY,edgeId:null})}} aria-label={'Editar nó '+node.label}>
                  <span className="ory-auto-node-type">{NAMES[NODE_REGISTRY[node.type].family]}</span><strong>{node.label}</strong><small>{NODE_REGISTRY[node.type].title}</small>
                </button>
                {node.type!=='trigger'&&<span className="ory-auto-node-input" title="Entrada"/>}
                <div className="ory-auto-node-outputs">{node.ports.filter(port=>port!=='in').map(port=>
                  <button key={port} className={sourcePort?.nodeId===node.id&&sourcePort.port===port?'active':''} onClick={()=>setSourcePort({nodeId:node.id,port})} title={'Conectar saída '+port} aria-label={'Conectar saída '+port}>{port}</button>)}</div>
              </div>)}
            </div>
            <div className="ory-auto-canvas-controls"><button onClick={()=>setZoom(v=>Math.max(0.65,+(v-0.1).toFixed(2)))} aria-label="Diminuir zoom"><ZoomOut size={16}/></button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(v=>Math.min(1.5,+(v+0.1).toFixed(2)))} aria-label="Aumentar zoom"><ZoomIn size={16}/></button><button onClick={fit}>100%</button></div>
            {menu&&<div className="ory-auto-context" style={{position:'fixed',left:Math.min(menu.x,window.innerWidth-205),top:Math.min(menu.y,window.innerHeight-110)}}><button onClick={()=>{setMenu(null);if(menu.edgeId)setActiveEdge(menu.edgeId)}}>Selecionar conexão</button><button onClick={()=>{setMenu(null);setSourcePort(null)}}>Cancelar conexão</button></div>}
          </div>
          <aside className="ory-auto-inspector">
            <div className="ory-auto-inspector-title"><Settings2 size={16}/><h3>Inspetor</h3></div>
            {selected ? <><span className="ory-auto-overline">PROPRIEDADES DO BLOCO</span><label>Nome<input value={selected.label} onChange={e=>commit({ok:true,graph:{...current,nodes:current.nodes.map(n=>n.id===selected.id?{...n,label:e.target.value}:n)}})}/></label>
              <label>Configuração JSON<textarea aria-label="Configuração JSON do nó" spellCheck={false} rows={9} value={jsonConfig} onChange={e=>setJsonConfig(e.target.value)}/></label>
              <button onClick={applyJsonConfig}>Aplicar configuração</button>
              {selected.type!=='trigger'&&<button className="ory-auto-danger" onClick={()=>{commit(removeNode(current,selected.id));setSelectedId(null)}}>Remover bloco</button>}
              <p className="ory-auto-aside-hint">Alterações locais exigem validação e publicação por servidor antes de produzir efeitos.</p>
            </> : activeEdge ? <><p>Conexão selecionada. Escolha um bloco na biblioteca à esquerda para inseri-lo entre os nós.</p><button onClick={()=>setActiveEdge(null)}>Desmarcar conexão</button></> :
              <div className="ory-auto-empty-inspector"><GitBranch size={26}/><strong>Selecione um bloco</strong><p>Clique em um nó para editar. Use os botões + nas linhas para inserir etapas.</p></div>}
            <div className="ory-auto-check"><h4>Integridade do fluxo</h4><span className={validation?.ok?'valid':'invalid'}>{validation?.ok?'Estrutura conectada':(validation?.issues.length||0)+' observações'}</span>
              {(validation?.issues||[]).slice(0,4).map((issue,i)=><p key={i}>{issue.code} · {issue.path}</p>)}</div>
          </aside>
        </div>
        {(notice||preview||sourcePort)&&<div className="ory-auto-status" role="status">{sourcePort?<span>Conectando: escolha o nó de destino ou pressione Esc.</span>:null}{notice&&<span>{notice}</span>}{preview&&<span>Simulação — não enviado · {preview.trace.length} nós visitados · {preview.issues.map(x=>x.code).join(', ')||'sem erro estrutural'}</span>}<button aria-label="Fechar aviso" onClick={()=>{setNotice('');setPreview(null);setSourcePort(null)}}><X size={15}/></button></div>}
      </div>}
      {tab!=='pipeline'&&tab!=='sdr'&&<div className="ory-auto-overview">
        <div className="ory-auto-section-heading"><div><span className="ory-auto-overline">CONTROLE E GOVERNANÇA</span><h2>{subviews[tab].title}</h2><p>{subviews[tab].description}</p></div></div>
        {tab==='overview' ? <div className="ory-auto-stat-grid">
          <div><span>Rascunhos locais</span><strong>{drafts.length}</strong><small>Sem efeitos em produção</small></div>
          <div><span>Fluxos publicados pela nova engine</span><strong>—</strong><small>Publicação ainda não habilitada</small></div>
          <div><span>Executor atual do SDR</span><strong>Preservado</strong><small>Sem alteração de worker</small></div>
        </div> : <div className="ory-auto-panel">
          <ShieldCheck size={26}/><h3>Integração protegida</h3>
          <p>{tab==='templates'?'Os templates aprovados na Meta não podem ser disparados por um editor ainda não homologado. A sincronização será feita no servidor.':tab==='executions'?'Histórico e execuções dependem da engine persistente com RLS e trilhas de auditoria. O CRM atual continua operando normalmente.':'Os gatilhos autorizados são definidos pelo backend. O editor aceita condições estruturadas e não executa JavaScript ou SQL arbitrário.'}</p>
          {(tab==='triggers')&&<button className="ory-auto-primary" onClick={()=>setTab('pipeline')}>Abrir biblioteca de fluxos <ArrowRight size={15}/></button>}
        </div>}
      </div>}
      <footer className="ory-auto-foot"><Clock3 size={14}/> Editor de preparação · sem merge, deploy ou ativação de fluxos</footer>
    </div>
  );
}
