import {useEffect,useMemo,useState} from 'react';
import {BookOpen,ShieldCheck,RefreshCcw,Save,LockKeyhole} from 'lucide-react';
import draftCandidate from '../../supabase/automation/sdr_intent_candidate.v1.json';
import {classifySdrIntent,validateIntentDictionary,type IntentDictionary,type IntentEntry} from '../../supabase/functions/_shared/sdr/intentPolicy.ts';
import {createRemoteSemanticDraft,freezeRemoteSemanticPair,listRemoteSemanticReleases,
 type SemanticDraft,type SemanticSnapshot} from './api.ts';
import './sdr-intelligence.css';
type Role='viewer'|'editor'|'publisher'|'admin'|null;
const initial:SemanticDraft={releaseVersion:1,language:'pt_BR',
 entries:draftCandidate.entries.map(e=>({...e,risk:e.risk as IntentEntry['risk']}))};
const lines=(text:string)=>text.split('\n').map(s=>s.trim()).filter(Boolean).slice(0,20);
export function SdrIntelligencePanel({workspaceId,role}:{workspaceId:string|null;role:Role}){
 const [draft,setDraft]=useState<SemanticDraft>(initial);
 const [selected,setSelected]=useState(initial.entries[0].id);
 const [versions,setVersions]=useState<SemanticSnapshot|null>(null);
 const [sample,setSample]=useState('Não quero cancelar, só saber o plano.');
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [error,setError]=useState('');
 const [confirm,setConfirm]=useState(false);
 const canWrite=role==='publisher'||role==='admin';
 const valid=validateIntentDictionary(draft);
 const item=draft.entries.find(x=>x.id===selected)||draft.entries[0];
 const decision=useMemo(()=>valid&&sample.trim()
  ?classifySdrIntent(sample,draft as IntentDictionary):null,[draft,sample,valid]);
 const refresh=async()=>{
  if(!workspaceId)return;
  setBusy(true);
  try{setVersions(await listRemoteSemanticReleases(workspaceId));setError('');}
  catch(e){setError(e instanceof Error?e.message:'Falha ao carregar versões.');}
  finally{setBusy(false);}
 };
 useEffect(()=>{if(workspaceId)void refresh();},[workspaceId]);
 const change=(key:'label'|'positive'|'negative'|'synonyms'|'risk',value:string)=>{
  setDraft(d=>({...d,entries:d.entries.map(x=>x.id!==selected?x:{
   ...x,[key]:['positive','negative','synonyms'].includes(key)?lines(value):value})}));
  setConfirm(false);
 };
 const latest=Math.max(0,...(versions?.dictionaries||[]).map(d=>d.version));
 const save=async()=>{
  if(!workspaceId||!canWrite||!valid||busy)return;
  setBusy(true);setError('');
  try{
   const next={...draft,releaseVersion:latest+1};
   const created=await createRemoteSemanticDraft(workspaceId,next,latest);
   setDraft(next);setMessage('Dicionário v'+created.release_version+
    ' salvo como rascunho inativo. Nenhum SDR foi alterado.');
   setVersions(await listRemoteSemanticReleases(workspaceId));
  }catch(e){setError(e instanceof Error?e.message:'Falha na gravação do rascunho.');}
  finally{setBusy(false);}
 };
 const freeze=async()=>{
  if(!workspaceId||!canWrite||!confirm||busy||!versions?.selected)return;
  const k=versions.knowledge.find(x=>x.status==='draft'&&!x.approved_by);
  const d=versions.dictionaries.find(x=>x.status==='draft'&&x.dictionary);
  if(!k||!d){setError('Não existe par de versões elegíveis para congelamento.');return;}
  setBusy(true);setError('');
  try{
   await freezeRemoteSemanticPair(workspaceId,k.id,d.id,versions.selected.revision);
   setMessage('Par de conhecimento congelado e DESATIVADO. SDR legado preservado.');
   setConfirm(false);setVersions(await listRemoteSemanticReleases(workspaceId));
  }catch(e){setError(e instanceof Error?e.message:'Publicação recusada.');}
  finally{setBusy(false);}
 };
 const eligible=canWrite&&!!versions?.selected
  &&versions.knowledge.some(x=>x.status==='draft'&&!x.approved_by)
  &&versions.dictionaries.some(x=>x.status==='draft'&&!!x.dictionary);
 return <section className="ory-sdr-intel" aria-label="Inteligência e intenções do SDR">
  <div className="ory-sdr-header"><div>
   <span><BookOpen size={15}/> ORYNEO / CONHECIMENTO COMERCIAL</span>
   <h3>Intenções e linguagem do SDR</h3>
   <p>Mapa editável e versionado. Não altera o treinamento atual nem inicia contatos sem liberação.</p>
  </div><button onClick={()=>void refresh()} disabled={!workspaceId||busy} aria-label="Recarregar releases">
   <RefreshCcw size={15}/> Atualizar</button></div>
  <div className="ory-sdr-metrics">
   <div><span>Intenções</span><strong>{draft.entries.length}</strong><small>Candidatas para revisão</small></div>
   <div><span>Playbook</span><strong>v1.0.0</strong><small>Fonte oficial · 64 capítulos</small></div>
   <div><span>Release no SDR</span><strong>{versions?.selected?.enabled?'Revisar':'Desligado'}</strong><small>Sem disparos por esta tela</small></div>
  </div>
  <div className="ory-sdr-layout">
   <aside className="ory-sdr-nav" aria-label="Intenções disponíveis">
    <h4>Mapa de intenções</h4>
    {draft.entries.map(e=><button type="button" key={e.id} aria-pressed={e.id===selected}
      className={e.id===selected?'active':''} onClick={()=>setSelected(e.id)}>
      <strong>{e.label}</strong><small>{e.risk==='human_review'?'Revisão humana':'Fluxo conversacional'}</small>
    </button>)}
   </aside>
   <div className="ory-sdr-edit">
    <header><h4>{item.label}</h4><small>{valid?'Estrutura válida':'Ajuste os exemplos obrigatórios'}</small></header>
    <label>Nome da intenção<input aria-label="Nome da intenção" maxLength={75} value={item.label}
      onChange={e=>change('label',e.target.value)}/></label>
    <label>Política de tratamento<select aria-label="Política de tratamento"
      value={item.risk} onChange={e=>change('risk',e.target.value)}>
       <option value="normal">Fluxo conversacional</option>
       <option value="human_review">Revisão humana obrigatória</option>
    </select></label>
    <label>Exemplos positivos <small>Um por linha</small>
      <textarea rows={4} aria-label="Exemplos positivos" value={item.positive.join('\n')}
       onChange={e=>change('positive',e.target.value)}/></label>
    <label>Exemplos negativos <small>Não devem disparar esta intenção</small>
      <textarea rows={4} aria-label="Exemplos negativos" value={item.negative.join('\n')}
       onChange={e=>change('negative',e.target.value)}/></label>
    <label>Sinônimos <small>Expressões sujeitas à revisão</small>
      <textarea rows={4} aria-label="Sinônimos" value={item.synonyms.join('\n')}
       onChange={e=>change('synonyms',e.target.value)}/></label>
   </div>
   <aside className="ory-sdr-inspect">
    <h4>Simular classificação</h4><p>Prévia local, sem modelo de IA ou mensagens enviadas.</p>
    <textarea rows={5} aria-label="Mensagem de teste" value={sample}
      onChange={e=>setSample(e.target.value)}/>
    <div role="status" className="ory-sdr-result">
     <span>Intenção detectada</span><strong>{decision?.intent||'Ambígua ou ausente'}</strong>
     <small>{decision?'Confiança '+Math.round(decision.confidence*100)+'% · '+decision.kind:'Sem decisão'}</small>
     <small>{decision?.humanReview?'Precisa de revisão humana':'Nenhum envio autorizado'}</small>
    </div>
    <h4>Histórico versionado</h4>
    <p>{versions?.knowledge.length||0} release(s) de conhecimento · {versions?.dictionaries.length||0} dicionário(s)</p>
    {(versions?.dictionaries||[]).slice(0,6).map(d=><button type="button"
      className="ory-sdr-version" key={d.id} disabled={!d.dictionary} onClick={()=>{
       if(!d.dictionary)return;
       setDraft({...d.dictionary,entries:d.dictionary.entries.map(e=>({...e,
        positive:[...e.positive],negative:[...e.negative],synonyms:[...e.synonyms]}))});
       setSelected(d.dictionary.entries[0]?.id||'');setConfirm(false);
       setMessage('Cópia da versão '+d.version+' carregada; original intocado.');
      }}>v{d.version}<span>{d.status}</span></button>)}
   </aside>
  </div>
  <div className="ory-sdr-footer">
   <div><h4><LockKeyhole size={15}/> Release protegido</h4>
    <p>Congelar versão não habilita o SDR. A decisão live exige outra etapa, autorização e rollback.</p>
    {eligible&&<label className="ory-sdr-confirm"><input type="checkbox" checked={confirm}
      onChange={e=>setConfirm(e.target.checked)}/> Confirmo a revisão das fontes e dos exemplos.</label>}
   </div>
   <div className="ory-sdr-buttons">
    <button type="button" disabled={!workspaceId||!canWrite||!valid||busy}
      onClick={()=>void save()}><Save size={14}/> Salvar nova versão</button>
    <button type="button" className="secondary" disabled={!eligible||!confirm||busy}
      onClick={()=>void freeze()}><ShieldCheck size={14}/> Congelar inativo</button>
   </div>
  </div>
  {(message||error)&&<p className={error?'ory-sdr-error':'ory-sdr-note'} role={error?'alert':'status'}>{error||message}</p>}
  {!canWrite&&<p className="ory-sdr-note">Apenas publicadores e administradores podem gravar novas versões.</p>}
 </section>;
}
