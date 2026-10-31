import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AlertCircle, ArrowRight, BookOpen, CirclePlay, Clock3, FileJson, GitBranch, History, Layers3, LockKeyhole, Plus, Redo2, Search, Settings2, ShieldCheck, Undo2, Workflow, X, ZoomIn, ZoomOut } from 'lucide-react';
import { connectPorts, reconnectEdge, createHistory, insertNodeOnEdge, moveNode, autoLayoutFlow, recordEdit, redoEdit, removeNode, undoEdit, type DraftHistory } from './graphEditing';
import { nodePalette, NODE_REGISTRY, type NodeFamily } from './nodeRegistry';
import { simulateFlow, validateFlow, type FlowDefinition, type FlowKind, type FlowNode, type NodeKind } from './flowDefinition';
import { loadAutomationWorkspaces, listRemoteAutomationFlows, loadRemoteAutomationFlow, saveRemoteAutomationDraft, listRemoteAutomationTemplates, listRemoteAutomationExecutions, validateRemoteAutomationDraft, freezeRemoteAutomationVersion, simulateRemoteAutomationDraft, loadRemoteNodeCatalog, loadRemoteAutomationRuntime, type AutomationRuntimeStatus, type NodeReferenceCatalog, type WorkspaceGrant, type RemoteFlow, type AutomationTemplate, type AutomationExecution } from './api';
import { ConditionRuleEditor } from './ConditionRuleEditor';
import { TypedNodeConfigEditor } from './TypedNodeConfigEditor';
import { STARTER_FLOWS, buildStarterFlow } from './starterFlows';
import { SIMULATION_CASES, buildSimulationCase, type SimulationCaseId } from './simulationCases';
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
    schema_version: '1.0.0', id, name: kind === 'sdr' ? 'Novo fluxo SDR' : 'Novo fluxo do pipeline',
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
  const [workspace, setWorkspace] = useState<WorkspaceGrant | null>(null);
  const [remoteFlows, setRemoteFlows] = useState<RemoteFlow[]>([]);
  const [metaTemplates, setMetaTemplates] = useState<AutomationTemplate[]>([]);
  const [nodeCatalog, setNodeCatalog] = useState<NodeReferenceCatalog | null>(null);
  const [runtimeStatus,setRuntimeStatus] = useState<AutomationRuntimeStatus | null>(null);
  const [remoteExecutions, setRemoteExecutions] = useState<AutomationExecution[]>([]);
  const [remoteRevision, setRemoteRevision] = useState<Record<string, number>>({});
  const [lastRemoteJson, setLastRemoteJson] = useState<Record<string,string>>({});
  const [syncError, setSyncError] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  useEffect(() => {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(userId)) return;
    let cancelled = false;
    void loadAutomationWorkspaces().then(async grants => {
      if (cancelled) return;
      const first = grants.find(item => item.slug === 'oryneo-crm') || grants[0];
      if (!first) { setSyncError('Sem autorização para o workspace de automações.'); return; }
      setWorkspace(first);
      const saved = await listRemoteAutomationFlows(first.id);
      if (!cancelled) { setRemoteFlows(saved); setRemoteRevision(Object.fromEntries(saved.map(flow => [flow.id, flow.revision]))); }
      const [registry, executions, catalog, runtime] = await Promise.allSettled([
        listRemoteAutomationTemplates(first.id), listRemoteAutomationExecutions(first.id),
        loadRemoteNodeCatalog(first.id), loadRemoteAutomationRuntime(first.id),
      ]);
      if (cancelled) return;
      if (registry.status === 'fulfilled') setMetaTemplates(registry.value);
      if (executions.status === 'fulfilled') setRemoteExecutions(executions.value);
      if (catalog.status === 'fulfilled') setNodeCatalog(catalog.value);
      if (runtime.status === 'fulfilled') setRuntimeStatus(runtime.value);
    }).catch(() => { if (!cancelled) setSyncError('Serviço de rascunhos indisponível. Use a cópia local.'); });
    return () => { cancelled = true; };
  }, [userId]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<DraftHistory | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeEdge, setActiveEdge] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  const [sourcePort, setSourcePort] = useState<{ nodeId: string; port: string } | null>(null);
  const [search, setSearch] = useState('');
  const [zoom, setZoom] = useState(1);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<ReturnType<typeof simulateFlow> | null>(null);
  const [simulationCase,setSimulationCase]=useState<SimulationCaseId>('unknown');
  const [jsonConfig, setJsonConfig] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; edgeId: string | null; nodeId: string | null; canvasX?: number; canvasY?: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; nodeId: string; originX: number; originY: number; startX: number; startY: number } | null>(null);
  const current = history?.graph;
  const canvasSize=useMemo(()=>({
    width:Math.max(1500,...(current?.nodes||[]).map(n=>n.position.x+330)),
    height:Math.max(950,...(current?.nodes||[]).map(n=>n.position.y+170)),
  }),[current]);
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
  const createFromStarter = (starterId: Parameters<typeof buildStarterFlow>[0]) => {
    open(buildStarterFlow(starterId));
    setNotice('Modelo editável, sem disparos. Revise consentimento e integrações antes de publicar.');
  };
  const openRemote = async (flowId: string) => {
    if (!workspace) return;
    setSyncBusy(true);
    try {
      const result = await loadRemoteAutomationFlow(workspace.id, flowId);
      if (!result.version?.graph_json) {
        setNotice('Ainda não existe versão do fluxo.');
        return;
      }
      // Published snapshots stay immutable; editing starts a NEW draft via CAS.
      const isPublished=result.version.status==='published';
      const draft:FlowDefinition=isPublished
        ? {...result.version.graph_json,status:'draft',version:result.version.version+1}
        : result.version.graph_json;
      open(draft);
      setRemoteRevision(revisions => ({ ...revisions, [flowId]: result.flow.revision }));
      if (!isPublished) setLastRemoteJson(previous=>({...previous,[flowId]:JSON.stringify(draft)}));
      setNotice(isPublished?'Versão publicada preservada. Edite e salve para criar um novo rascunho.':'Rascunho carregado do workspace ORYNEO, sem disparos.');
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Não foi possível abrir o fluxo.');
    } finally { setSyncBusy(false); }
  };
  const saveDraft = async () => {
    if (!current || syncBusy) return;
    const next = drafts.filter(d => d.id !== current.id).concat(current);
    if (!save(next)) return;
    setNotice('Cópia de segurança salva neste navegador.');
    if (!workspace) return;
    if (!['admin','publisher','editor'].includes(workspace.role)) {
      setNotice('Cópia local salva. Seu perfil não pode modificar o workspace.');
      return;
    }
    setSyncBusy(true);
    try {
      const result = await saveRemoteAutomationDraft(workspace.id, current, remoteRevision[current.id]);
      setRemoteRevision(revisions => ({ ...revisions, [current.id]: result.revision }));
      setLastRemoteJson(previous=>({...previous,[current.id]:JSON.stringify(current)}));
      const saved = await listRemoteAutomationFlows(workspace.id);
      setRemoteFlows(saved);
      setNotice('Rascunho salvo no workspace ORYNEO com revisão ' + result.revision + '. Nenhum disparo executado.');
    } catch (reason) {
      setNotice('Cópia local preservada. Sincronização não concluída: ' +
        (reason instanceof Error ? reason.message : 'servidor indisponível'));
    } finally { setSyncBusy(false); }
  };
  const freezeCanonicalVersion=async()=>{
    if (!workspace||!current||syncBusy||remoteRevision[current.id]===undefined
      || JSON.stringify(current)!==lastRemoteJson[current.id]) {
      setNotice('Salve o rascunho remoto antes de congelar a versão.');
      return;
    }
    if (!['admin','publisher'].includes(workspace.role)) {
      setNotice('É necessário o papel de publicador.');return;
    }
    setSyncBusy(true);
    try {
      const result=await freezeRemoteAutomationVersion(workspace.id,current.id,remoteRevision[current.id]);
      setRemoteRevision(prev=>({...prev,[current.id]:result.revision}));
      setLastRemoteJson(prev=>{const copy={...prev};delete copy[current.id];return copy;});
      setRemoteFlows(await listRemoteAutomationFlows(workspace.id));
      setNotice('Versão congelada sem ativar o runtime, nem enviar mensagens.');
      setOpenId(null);setHistory(null);
    } catch(reason) {
      setNotice('Publicação desativada não concluída: '+(reason instanceof Error?reason.message:'falha desconhecida'));
    } finally {setSyncBusy(false);}
  };
  const validateWithServer = async () => {
    if (!current) return;
    if (!workspace) {
      setNotice('Selecione um workspace autorizado para validar no servidor.');
      return;
    }
    setSyncBusy(true);
    try {
      const result = await validateRemoteAutomationDraft(workspace.id, current);
      setNotice(result.ok
        ? 'Pré-validação do servidor aprovada. Nenhuma publicação ou envio autorizado.'
        : 'Servidor: ' + result.issues.slice(0, 6)
          .map(issue => issue.code + ' (' + issue.path + ')').join(' · '));
    } catch (reason) {
      setNotice('Pré-validação indisponível: ' +
        (reason instanceof Error ? reason.message : 'falha de conexão'));
    } finally { setSyncBusy(false); }
  };
  const simulateWithServer = async () => {
    if(!current||!workspace)return;
    const eventType=String(current.nodes.find(n=>n.type==='trigger')?.config.event_type||'');
    setSyncBusy(true);
    try {
      const result=await simulateRemoteAutomationDraft(workspace.id,current,eventType,buildSimulationCase(simulationCase));
      setNotice('Simulação do servidor — nenhum envio, nenhuma gravação · '+
        result.state+' · '+result.trace.length+' nós · '+
        (result.issues.map(issue=>issue.code).join(', ')||'sem erros de execução'));
    }catch(error){
      setNotice('Simulação do servidor indisponível: '+
        (error instanceof Error?error.message:'falha desconhecida'));
    }finally{setSyncBusy(false);}
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
  const addAtCanvas = (type: NodeKind) => {
    if (!current || !menu || !history || current.nodes.length >= 500
      || type === 'trigger' || !nodePalette(current.kind).some(item=>item.type===type)) return;
    const descriptor=NODE_REGISTRY[type];
    const node:FlowNode={
      id:crypto.randomUUID(),type,label:descriptor.title,
      position:{x:Math.max(15,Math.min(1260,menu.canvasX??200)),
        y:Math.max(15,Math.min(820,menu.canvasY??150))},
      ports:[...(descriptor.input?['in']:[]),...descriptor.outputs],
      config:defaultConfig(type,current.kind),
    };
    commit({ok:true,graph:{...current,nodes:[...current.nodes,node]}});
    setSelectedId(node.id);setJsonConfig(JSON.stringify(node.config,null,2));setMenu(null);
    setNotice('Bloco criado. Conecte as portas antes de validar ou publicar.');
  };
  const onNodePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, node: FlowNode) => {
    if (event.button !== 0) return;
    pointer.current = { id: event.pointerId, nodeId: node.id, originX: event.clientX, originY: event.clientY, startX: node.position.x, startY: node.position.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onNodePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const p = pointer.current;
    if (!p || !current || p.id !== event.pointerId) return;
    pointer.current = null;
    const dx = (event.clientX - p.originX) / zoom, dy = (event.clientY - p.originY) / zoom;
    if (Math.abs(dx) + Math.abs(dy) > 3) commit(moveNode(current, p.nodeId, { x: Math.max(12,p.startX+dx), y: Math.max(12,p.startY+dy) }));
  };
  const showNode = (node: FlowNode) => {
    if (reconnecting && current) {
      commit(reconnectEdge(current, reconnecting, node.id));
      setReconnecting(null); setActiveEdge(null); return;
    }
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
      if (event.key === 'Escape') { setSourcePort(null); setReconnecting(null); setMenu(null); }
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
        <span className="ory-auto-safe"><LockKeyhole size={14}/> {runtimeStatus ? (runtimeStatus.emergencyStop?'Motor em parada de emergência':`Motor ${runtimeStatus.mode}`) : 'Estado do motor não confirmado'}</span>
      </div>
      <nav className="ory-auto-tabs" aria-label="Áreas de automações">
        {TABS.map(item => <button key={item.key} type="button" className={tab===item.key?'active':''} onClick={() => {
          setTab(item.key); setMenu(null); setSourcePort(null); if (item.key !== 'pipeline' && item.key !== 'sdr') setOpenId(null);
        }}><item.icon size={15}/>{item.label}</button>)}
      </nav>
      {dirtyError && <div role="alert" className="ory-auto-warning"><AlertCircle size={15}/>{dirtyError}</div>}
      {syncError && <div role="status" className="ory-auto-warning"><AlertCircle size={15}/>{syncError}</div>}
      {(tab === 'pipeline' || tab === 'sdr') && !displayBuilder && <div className="ory-auto-list">
        <div className="ory-auto-list-heading">
          <div><span className="ory-auto-overline">BIBLIOTECA DE FLUXOS</span><h2>{tab === 'sdr' ? 'Fluxos conversacionais SDR' : 'Fluxos do pipeline'}</h2><p>Rascunhos locais e não publicados. Os disparos atuais permanecem no motor existente.</p></div>
          <button className="ory-auto-primary" onClick={()=>create(tab)}><Plus size={17}/> Novo fluxo</button>
        </div>
        <div className="ory-auto-flows">
          {remoteFlows.filter(g=>g.kind===tab).map(flow=><button className="ory-auto-flow-card" disabled={syncBusy} key={'remote-'+flow.id} onClick={()=>void openRemote(flow.id)}>
            <span className="ory-auto-flow-icon"><Workflow size={21}/></span>
            <span><strong>{flow.name}</strong><small>Workspace ORYNEO · revisão {flow.revision} · {flow.enabled?'ativo':'inativo'}</small></span><ArrowRight size={17}/>
          </button>)}
          {drafts.filter(g=>g.kind===tab && !remoteFlows.some(remote=>remote.id===g.id)).map(flow=><button className="ory-auto-flow-card" key={flow.id} onClick={()=>open(flow)}>
            <span className="ory-auto-flow-icon"><Workflow size={21}/></span>
            <span><strong>{flow.name}</strong><small>{flow.nodes.length} nós · {flow.edges.length} conexões · rascunho local</small></span><ArrowRight size={17}/>
          </button>)}
          <button className="ory-auto-flow-card ory-auto-create-card" onClick={()=>create(tab)}><Plus size={21}/><span><strong>Criar fluxo</strong><small>Começar com gatilho e conclusão conectados</small></span></button>
          {STARTER_FLOWS.filter(starter=>starter.kind===tab).map(starter=>(
            <button className="ory-auto-flow-card" key={'starter-'+starter.id}
              title={starter.note} onClick={()=>createFromStarter(starter.id)}>
              <span className="ory-auto-flow-icon"><GitBranch size={20}/></span>
              <span><strong>{starter.name}</strong><small>Modelo editável · sem envio · aprovação necessária</small></span>
              <ArrowRight size={17}/>
            </button>
          ))}
        </div>
      </div>}
      {displayBuilder && <div className="ory-auto-editor">
        <div className="ory-auto-editor-toolbar">
          <div className="ory-auto-editor-name"><button aria-label="Voltar à lista" onClick={()=>{setOpenId(null);setHistory(null)}}><ArrowRight size={17} style={{transform:'rotate(180deg)'}}/></button>
            <input aria-label="Nome do fluxo" value={current.name} maxLength={160} onChange={e => commit({ok:true,graph:{...current,name:e.target.value}})}/><span className="ory-auto-draft">RASCUNHO · V{current.version}</span>
          </div>
          <div className="ory-auto-editor-actions">
            <button title="Organizar nós automaticamente" onClick={()=>commit(autoLayoutFlow(current))}><Layers3 size={16}/>Organizar</button>
            <button title="Desfazer" onClick={()=>setHistory(h=>h?undoEdit(h):h)} disabled={!history?.undo.length}><Undo2 size={16}/></button>
            <button title="Refazer" onClick={()=>setHistory(h=>h?redoEdit(h):h)} disabled={!history?.redo.length}><Redo2 size={16}/></button>
            <button title="Validar grafo" onClick={()=>setNotice(validation?.ok?'Grafo estruturalmente válido. Ainda requer homologação no servidor.':(validation?.issues||[]).map(x=>x.code).join(' · '))}><ShieldCheck size={16}/>Validar</button>
            <button title="Pré-validar no servidor (sem publicar)" disabled={syncBusy || !workspace} onClick={()=>void validateWithServer()}><ShieldCheck size={16}/>Servidor</button>
            <button title="Simular no servidor sem enviar" disabled={!workspace||syncBusy}
              onClick={()=>void simulateWithServer()}><CirclePlay size={16}/>Prévia servidor</button>
            <button title="Simular sem efeitos externos" onClick={()=>{
              setPreview(simulateFlow(current,{eventType:String(current.nodes.find(n=>n.type==='trigger')?.config.event_type||''),context:{...buildSimulationCase(simulationCase),event:{type:String(current.nodes.find(n=>n.type==='trigger')?.config.event_type||'')}}}));
            }}><CirclePlay size={16}/>Simular</button>
            <button title="Exportar rascunho em JSON" onClick={exportDraft}><FileJson size={16}/></button>
            <button className="ory-auto-primary" disabled={syncBusy} onClick={()=>void saveDraft()}>{syncBusy?'Salvando…':'Salvar rascunho'}</button>
            {workspace&&['admin','publisher'].includes(workspace.role)&&<button
              title="Congelar versão homologada sem ativar automações" disabled={syncBusy||!current||remoteRevision[current.id]===undefined||JSON.stringify(current)!==lastRemoteJson[current.id]}
              onClick={()=>void freezeCanonicalVersion()}><ShieldCheck size={14}/>Congelar versão</button>}
            <button title="Publicação disponível após engine homologada" disabled>Ativar <LockKeyhole size={13}/></button>
          </div>
        </div>
        <div className="ory-auto-simulation-bar">
          <label htmlFor="ory-auto-simulation-case">Cenário de teste</label>
          <select id="ory-auto-simulation-case" aria-label="Cenário de simulação hipotética"
            value={simulationCase}
            onChange={event=>setSimulationCase(event.target.value as SimulationCaseId)}>
            {SIMULATION_CASES.map(item=>
              <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
          <span>{SIMULATION_CASES.find(item=>item.id===simulationCase)?.description}</span>
          <small>Nenhum dado real, mensagem ou cobrança é utilizado na simulação.</small>
        </div>
        <div className="ory-auto-editor-main">
          <aside className="ory-auto-palette"><h3>Biblioteca de nós</h3><label className="ory-auto-palette-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar bloco"/></label>
            {([...new Set(nodePalette(current.kind).map(x=>x.descriptor.family))] as NodeFamily[]).map(family=><div className="ory-auto-palette-group" key={family}><h4>{NAMES[family]}</h4>
              {nodePalette(current.kind).filter(x=>x.descriptor.family===family && x.descriptor.title.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))).map(({type,descriptor})=>
                <button key={type} disabled={!activeEdge || ['trigger','end','stop'].includes(type)} title={activeEdge?'Inserir bloco na conexão selecionada':'Selecione uma conexão no canvas para inserir o bloco'} onClick={()=>activeEdge&&addToEdge(activeEdge,type)}>
                  <span className={'ory-auto-palette-dot family-'+family}/>{descriptor.title}<Plus size={13}/>
                </button>)}</div>)}
          </aside>
          <div className="ory-auto-canvas-scroll" ref={stage} onContextMenu={e=>{
            if ((e.target as Element).closest('.ory-auto-node,.ory-auto-edge-add,.ory-auto-context')) return;
            e.preventDefault();
            const bounds=e.currentTarget.getBoundingClientRect();
            const canvasX=(e.clientX-bounds.left+e.currentTarget.scrollLeft)/zoom;
            const canvasY=(e.clientY-bounds.top+e.currentTarget.scrollTop)/zoom;
            setMenu({x:e.clientX,y:e.clientY,edgeId:null,nodeId:null,canvasX,canvasY});
          }}>
            <div className="ory-auto-canvas" style={{transform:'scale('+zoom+')',transformOrigin:'top left',width:canvasSize.width,height:canvasSize.height}}>
              <svg aria-hidden="true" className="ory-auto-connections" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} style={{width:canvasSize.width,height:canvasSize.height}} preserveAspectRatio="none">
                {current.edges.map(edge=>{
                  const src=current.nodes.find(n=>n.id===edge.source),dst=current.nodes.find(n=>n.id===edge.target);if(!src||!dst)return null;
                  const x1=src.position.x+220,y1=src.position.y+43,x2=dst.position.x,y2=dst.position.y+43;
                  return <path key={edge.id} d={'M'+x1+' '+y1+' C'+(x1+90)+' '+y1+' '+(x2-90)+' '+y2+' '+x2+' '+y2} className={activeEdge===edge.id?'selected':''}/>;
                })}
              </svg>
              {current.edges.map(edge=>{
                const src=current.nodes.find(n=>n.id===edge.source),dst=current.nodes.find(n=>n.id===edge.target);if(!src||!dst)return null;
                const x=(src.position.x+220+dst.position.x)/2,y=(src.position.y+dst.position.y)/2+43;
                return <button key={edge.id} className={'ory-auto-edge-add'+(activeEdge===edge.id?' active':'')} style={{left:x,top:y}} aria-label="Selecionar conexão para inserir nó" title="Inserir bloco nesta conexão" onClick={()=>{setActiveEdge(edge.id);setSelectedId(null)}} onContextMenu={e=>{e.preventDefault();setActiveEdge(edge.id);setMenu({x:e.clientX,y:e.clientY,edgeId:edge.id,nodeId:null})}}><Plus size={13}/></button>;
              })}
              {current.nodes.map(node=><div className={'ory-auto-node family-'+NODE_REGISTRY[node.type].family+(selectedId===node.id?' selected':'')+(node.disabled?' disabled':'')} key={node.id} style={{left:node.position.x,top:node.position.y}}>
                <button className="ory-auto-node-body" onClick={()=>showNode(node)} onPointerDown={e=>onNodePointerDown(e,node)} onPointerUp={onNodePointerUp} onContextMenu={e=>{e.preventDefault();showNode(node);setMenu({x:e.clientX,y:e.clientY,edgeId:null,nodeId:node.id})}} aria-label={'Editar nó '+node.label}>
                  <span className="ory-auto-node-type">{NAMES[NODE_REGISTRY[node.type].family]}</span><strong>{node.label}</strong><small>{NODE_REGISTRY[node.type].title}</small>
                </button>
                {node.type!=='trigger'&&<span className="ory-auto-node-input" title="Entrada"/>}
                <div className="ory-auto-node-outputs">{node.ports.filter(port=>port!=='in').map(port=>
                  <button key={port} className={sourcePort?.nodeId===node.id&&sourcePort.port===port?'active':''} onClick={()=>setSourcePort({nodeId:node.id,port})} title={'Conectar saída '+port} aria-label={'Conectar saída '+port}>{port}</button>)}</div>
              </div>)}
            </div>
            <div className="ory-auto-canvas-controls"><button onClick={()=>setZoom(v=>Math.max(0.65,+(v-0.1).toFixed(2)))} aria-label="Diminuir zoom"><ZoomOut size={16}/></button><span>{Math.round(zoom*100)}%</span><button onClick={()=>setZoom(v=>Math.min(1.5,+(v+0.1).toFixed(2)))} aria-label="Aumentar zoom"><ZoomIn size={16}/></button><button onClick={fit}>100%</button></div>
            {menu&&<div className="ory-auto-context" style={{position:'fixed',left:Math.min(menu.x,window.innerWidth-205),top:Math.min(menu.y,window.innerHeight-150)}}>
              {menu.nodeId&&current.edges.some(edge=>edge.source===menu.nodeId) && <button onClick={()=>{
                const outgoing=current.edges.find(edge=>edge.source===menu.nodeId && edge.source_port==='out') ||
                  current.edges.find(edge=>edge.source===menu.nodeId);
                if(outgoing) addToEdge(outgoing.id,'condition');
                setMenu(null);
              }}>Criar condição conectada</button>}
              {!menu.nodeId&&!menu.edgeId&&current&&nodePalette(current.kind)
                .filter(item=>item.type!=='trigger')
                .map(({type,descriptor})=><button key={type} type="button"
                  onClick={()=>addAtCanvas(type)}>Adicionar: {descriptor.title}</button>)}
              {menu.edgeId&&<button onClick={()=>{setActiveEdge(menu.edgeId);setMenu(null)}}>Inserir nó nesta conexão</button>}
              {menu.edgeId&&<button onClick={()=>{setReconnecting(menu.edgeId);setMenu(null);setNotice('Clique no nó de destino para reconectar.')}}>Reconectar destino</button>}
              <button onClick={()=>{setMenu(null);setSourcePort(null);setReconnecting(null)}}>Fechar menu</button>
            </div>}
          </div>
          <aside className="ory-auto-inspector">
            <div className="ory-auto-inspector-title"><Settings2 size={16}/><h3>Inspetor</h3></div>
            {selected ? <><span className="ory-auto-overline">PROPRIEDADES DO BLOCO</span><label>Nome<input value={selected.label} onChange={e=>commit({ok:true,graph:{...current,nodes:current.nodes.map(n=>n.id===selected.id?{...n,label:e.target.value}:n)}})}/></label>
              {selected.type==='condition' ? <ConditionRuleEditor value={selected.config.rule} onChange={rule=>commit({ok:true,graph:{
                ...current,nodes:current.nodes.map(n=>n.id===selected.id?{...n,config:{rule}}:n),
              }})}/> : <>
                <TypedNodeConfigEditor node={selected} catalog={nodeCatalog} onChange={config=>{
                  commit({ok:true,graph:{...current,nodes:current.nodes.map(n=>n.id===selected.id?{...n,config}:n)}});
                  setJsonConfig(JSON.stringify(config,null,2));
                }}/>
                <p className="ory-auto-inspector-advanced">Configuração avançada · JSON</p>
                <label>Configuração JSON<textarea aria-label="Configuração JSON do nó" spellCheck={false} rows={7} value={jsonConfig} onChange={e=>setJsonConfig(e.target.value)}/></label>
                <button onClick={applyJsonConfig}>Aplicar configuração</button>
              </>}
              {selected.type!=='trigger'&&<button className="ory-auto-danger" onClick={()=>{commit(removeNode(current,selected.id));setSelectedId(null)}}>Remover bloco</button>}
              <p className="ory-auto-aside-hint">Alterações locais exigem validação e publicação por servidor antes de produzir efeitos.</p>
            </> : activeEdge ? <><p>Conexão selecionada. Escolha um bloco na biblioteca à esquerda para inseri-lo entre os nós.</p><button onClick={()=>{setReconnecting(activeEdge);setNotice('Selecione o novo nó de destino no canvas.')}}>Reconectar destino</button><button onClick={()=>setActiveEdge(null)}>Desmarcar conexão</button></> :
              <div className="ory-auto-empty-inspector"><GitBranch size={26}/><strong>Selecione um bloco</strong><p>Clique em um nó para editar. Use os botões + nas linhas para inserir etapas.</p></div>}
            <div className="ory-auto-check"><h4>Integridade do fluxo</h4><span className={validation?.ok?'valid':'invalid'}>{validation?.ok?'Estrutura conectada':(validation?.issues.length||0)+' observações'}</span>
              {(validation?.issues||[]).slice(0,4).map((issue,i)=><p key={i}>{issue.code} · {issue.path}</p>)}</div>
          </aside>
        </div>
        {(notice||preview||sourcePort||reconnecting)&&<div className="ory-auto-status" role="status">{sourcePort?<span>Conectando: escolha o nó de destino ou pressione Esc.</span>:null}{reconnecting?<span>Reconectando: escolha o nó de destino ou pressione Esc.</span>:null}{notice&&<span>{notice}</span>}{preview&&<span>Simulação — não enviado · {preview.trace.length} nós visitados · {preview.issues.map(x=>x.code).join(', ')||'sem erro estrutural'}</span>}<button aria-label="Fechar aviso" onClick={()=>{setNotice('');setPreview(null);setSourcePort(null);setReconnecting(null)}}><X size={15}/></button></div>}
      </div>}
      {tab!=='pipeline'&&tab!=='sdr'&&<div className="ory-auto-overview">
        <div className="ory-auto-section-heading"><div><span className="ory-auto-overline">CONTROLE E GOVERNANÇA</span><h2>{subviews[tab].title}</h2><p>{subviews[tab].description}</p></div></div>
        {tab==='overview' ? <div className="ory-auto-stat-grid">
          <div><span>Rascunhos locais</span><strong>{drafts.length}</strong><small>Backups neste dispositivo</small></div>
          <div><span>Fluxos no workspace</span><strong>{runtimeStatus?.flows ?? remoteFlows.length}</strong><small>{runtimeStatus ? `${runtimeStatus.publishedVersions} versões congeladas · ${runtimeStatus.mode}` : 'Motor sem telemetria confirmada'}</small></div>
          <div><span>Templates Meta sincronizados</span><strong>{metaTemplates.length||'—'}</strong><small>Envios exigem status e consentimento válidos no momento do disparo</small></div>
          <div><span>Eventos pendentes</span><strong>{runtimeStatus?.pendingEvents ?? '—'}</strong><small>Observação autorizada do servidor</small></div>
          <div><span>Registros de ação</span><strong>{runtimeStatus?.actionRows ?? '—'}</strong><small>{runtimeStatus?.emergencyStop ? 'Bloqueados pela parada de emergência' : 'Consulte a política ativa'}</small></div>
          <div><span>Esperas em andamento</span><strong>{runtimeStatus?.waitingTimers ?? '—'}</strong><small>Canceladas por resposta: {runtimeStatus?.cancelledTimers ?? '—'}</small></div>
          <div><span>Esperas vencidas</span><strong>{runtimeStatus?.dueTimers ?? '—'}</strong><small>Somente observação, sem envio automático</small></div>
          <div><span>Envios com resultado incerto</span><strong>{runtimeStatus?.uncertainActions ?? '—'}</strong><small>Exigem reconciliação com o provedor; não reenviar automaticamente</small></div>
          <div><span>Envios confirmados pela nova engine</span><strong>{runtimeStatus?.sentActions ?? '—'}</strong><small>Na fila: {runtimeStatus?.queuedActions ?? '—'} · Reservados: {runtimeStatus?.leasedActions ?? '—'}</small></div>
        </div> : tab==='templates' ? <div className="ory-auto-catalog">
          <div className="ory-auto-catalog-heading"><div><strong>Catálogo oficial de templates</strong><p>Sincronização read-only da Meta. Status pode mudar; envio exige revalidação no servidor.</p></div><span>{metaTemplates.length} cadastrados</span></div>
          {metaTemplates.length ? <div className="ory-auto-catalog-scroll"><table><thead><tr><th>Nome do template</th><th>Categoria</th><th>Idioma</th><th>Status</th></tr></thead><tbody>
            {metaTemplates.map(item=><tr key={item.id}><td>{item.template_name}<small>ID {item.provider_template_id||'não disponível'}</small></td>
              <td>{item.category}</td><td>{item.language}</td>
              <td><span className="ory-auto-approved">{item.provider_status}</span></td></tr>)}
          </tbody></table></div>:<p className="ory-auto-no-data">Sem catálogo carregado. O CRM não autoriza envios pela nova engine enquanto a sincronização não for verificada.</p>}
        </div> : tab==='executions' ? <div className="ory-auto-catalog">
          <div className="ory-auto-catalog-heading"><div><strong>Execuções registradas</strong><p>Consulta autorizada aos registros da nova engine. Sem disparos ativos.</p></div><span>{remoteExecutions.length} registros</span></div>
          {remoteExecutions.length ? <div className="ory-auto-catalog-scroll"><table><thead><tr><th>Execução</th><th>Estado</th><th>Início</th></tr></thead><tbody>
            {remoteExecutions.map(item=><tr key={item.id}><td>{item.id.slice(0,12)}…</td><td>{item.state}</td><td>{new Date(item.started_at).toLocaleString('pt-BR')}</td></tr>)}
          </tbody></table></div> : <div className="ory-auto-no-data"><History size={26}/><p>Nenhuma execução registrada na nova engine. O SDR atual continua no processamento original.</p></div>}
        </div> : <div className="ory-auto-panel">
          <ShieldCheck size={26}/><h3>Condições e eventos canônicos</h3>
          <p>O editor aceita condições estruturadas e não executa JavaScript ou SQL arbitrário. Configurações precisam ser validadas pelo backend antes da publicação.</p>
          <button className="ory-auto-primary" onClick={()=>setTab('pipeline')}>Abrir biblioteca de fluxos <ArrowRight size={15}/></button>
        </div>}
      </div>}
      <footer className="ory-auto-foot"><Clock3 size={14}/> Editor de preparação · sem merge, deploy ou ativação de fluxos</footer>
    </div>
  );
}
