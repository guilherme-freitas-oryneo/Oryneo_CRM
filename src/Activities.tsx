import {useMemo,useState} from 'react';
import {Activity,ArrowRight,CalendarClock,Check,CheckCircle2,Clock3,Search,CalendarDays,AlertCircle,Pencil,X,UsersRound} from 'lucide-react';
import {supabase,errorText,money,type DealRow,type StageRow,type NextAction} from './data';
import './activities.css';
type Bucket='all'|'overdue'|'today'|'upcoming'|'undated'|'done';
const todayKey=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const keyFor=(value:string|null|undefined)=>{if(!value)return '';const d=new Date(value);if(Number.isNaN(d.getTime()))return '';return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const shortDate=(value:string|null|undefined)=>{if(!value)return 'Sem prazo definido';const d=new Date(value);return Number.isNaN(d.getTime())?'Sem prazo definido':d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})};
const actionOf=(deal:DealRow):NextAction=>deal.data.next_action??{title:'Realizar diagnóstico inicial',done:false,due_at:null};
const category=(deal:DealRow,day:string):Bucket=>{
 const action=actionOf(deal);
 if(action.done)return 'done';
 const due=keyFor(action.due_at);
 if(!due)return 'undated';
 return due<day?'overdue':due===day?'today':'upcoming';
};
const tabs:{key:Bucket;label:string}[]=[
 {key:'all',label:'Todas'},{key:'overdue',label:'Vencidas'},{key:'today',label:'Hoje'},{key:'upcoming',label:'Próximas'},{key:'undated',label:'Sem prazo'},{key:'done',label:'Concluídas'}
];
const labels:Record<Bucket,string>={all:'Todas',overdue:'Vencida',today:'Para hoje',upcoming:'Próxima',undated:'Prazo a definir',done:'Concluída'};
export function Activities({deals,stages,onOpen,onChanged}:{deals:DealRow[];stages:StageRow[];onOpen:(id:string)=>void;onChanged:()=>Promise<void>}){
 const [filter,setFilter]=useState<Bucket>('all');
 const [term,setTerm]=useState('');
 const [editing,setEditing]=useState<string|null>(null);
 const [actionTitle,setActionTitle]=useState('');
 const [actionDue,setActionDue]=useState('');
 const [actionDone,setActionDone]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const day=todayKey();
 const items=useMemo(()=>deals.map(deal=>({deal,action:actionOf(deal),bucket:category(deal,day)})),[deals,day]);
 const counts=useMemo(()=>Object.fromEntries(tabs.map(tab=>[tab.key,tab.key==='all'?items.length:items.filter(i=>i.bucket===tab.key).length])) as Record<Bucket,number>,[items]);
 const selected=deals.find(d=>d.id===editing);
 const filtered=useMemo(()=>{
  const needle=term.trim().toLocaleLowerCase('pt-BR');
  const result=items.filter(i=>(filter==='all'||i.bucket===filter)&&(!needle||[i.action.title,i.deal.data.company,i.deal.data.contact,i.deal.data.title].join(' ').toLocaleLowerCase('pt-BR').includes(needle)));
  const order:Record<Bucket,number>={overdue:0,today:1,upcoming:2,undated:3,done:4,all:5};
  return result.sort((a,b)=>order[a.bucket]-order[b.bucket]||(a.action.due_at||'~').localeCompare(b.action.due_at||'~')||a.deal.created_at.localeCompare(b.deal.created_at));
 },[filter,term,items]);
 const beginEdit=(deal:DealRow)=>{
  const a=actionOf(deal);setEditing(deal.id);setActionTitle(a.title);setActionDue(a.due_at?new Date(a.due_at).toLocaleString('sv-SE',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).replace(' ','T'):'');setActionDone(a.done);setError('');setNotice('');
 };
 const write=async(deal:DealRow,title:string,due:string|null,done:boolean)=>{
  if(busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const {error:rpcError}=await supabase.rpc('crm_set_action',{p_deal_id:deal.id,p_revision:deal.revision,p_title:title.trim(),p_due_at:due,p_done:done});
   if(rpcError)throw rpcError;
   await onChanged();
   setEditing(null);
   setNotice('Atividade salva e registrada no histórico.');
  }catch(e){setError(errorText(e));await onChanged().catch(()=>{})}
  finally{setBusy(false)}
 };
 const save=()=>{
  if(!selected||!actionTitle.trim())return;
  const d=actionDue?new Date(actionDue):null;
  if(d&&Number.isNaN(d.getTime())){setError('Confira a data e o horário.');return}
  void write(selected,actionTitle,d?d.toISOString():null,actionDone);
 };
 return <div className="activity-page">
  <header className="activity-header">
   <div><span className="activity-eyebrow">CENTRAL DE ACOMPANHAMENTO COMERCIAL</span><h1>Atividades<span className="activity-heading-dot"/></h1><p>Organize diagnósticos, retornos e próximos passos sem perder o vínculo com cada oportunidade.</p></div>
   <span className="activity-overview-icon"><CalendarClock size={25}/></span>
  </header>
  <div className="activity-kpis">
   <button className="activity-kpi" onClick={()=>setFilter('overdue')} aria-label="Mostrar atividades vencidas"><span><AlertCircle size={16}/> Vencidas</span><strong>{counts.overdue}</strong><small>Requerem atenção</small></button>
   <button className="activity-kpi" onClick={()=>setFilter('today')} aria-label="Mostrar atividades de hoje"><span><CalendarDays size={16}/> Para hoje</span><strong>{counts.today}</strong><small>Ações do dia</small></button>
   <button className="activity-kpi" onClick={()=>setFilter('undated')} aria-label="Mostrar atividades sem prazo"><span><Clock3 size={16}/> Sem prazo</span><strong>{counts.undated}</strong><small>Agendamento pendente</small></button>
   <button className="activity-kpi" onClick={()=>setFilter('done')} aria-label="Mostrar atividades concluídas"><span><CheckCircle2 size={16}/> Concluídas</span><strong>{counts.done}</strong><small>Ações finalizadas</small></button>
  </div>
  <section className="activity-surface">
   <div className="activity-toolbar"><div className="activity-toolbar-heading"><Activity size={18}/><strong>Próximas ações</strong><span>{items.length}</span></div><div className="activity-search"><Search size={16}/><input value={term} onChange={e=>setTerm(e.target.value)} aria-label="Pesquisar atividades" placeholder="Buscar empresa, contato ou ação"/></div></div>
   <div className="activity-tabs" role="tablist" aria-label="Filtrar atividades">{tabs.map(t=><button type="button" role="tab" aria-selected={filter===t.key} className={filter===t.key?'selected':''} onClick={()=>setFilter(t.key)} key={t.key}>{t.label}<span>{counts[t.key]}</span></button>)}</div>
   {notice&&<p className="activity-notice" role="status">{notice}</p>}{error&&!editing&&<p className="activity-error" role="alert">{error}</p>}
   <div className="activity-list">{filtered.length?filtered.map(({deal,action,bucket})=>{
    const stage=stages.find(x=>x.id===deal.data.stage_id);
    return <article className="activity-entry" key={deal.id}>
     <span className={'activity-entry-icon status-'+bucket}>{action.done?<Check size={18}/>:<CalendarClock size={18}/>}</span>
     <div className="activity-entry-main"><div className="activity-entry-meta"><span className={'activity-status status-'+bucket}>{labels[bucket]}</span>{stage&&<span className="activity-stage">{stage.data.name}</span>}</div><button className="activity-entry-title" onClick={()=>onOpen(deal.id)}>{action.title||'Realizar diagnóstico inicial'}</button><p>{deal.data.company||deal.data.title}{deal.data.contact?' · '+deal.data.contact:''}</p><span className="activity-entry-date"><Clock3 size={13}/>{shortDate(action.due_at)}</span></div>
     <div className="activity-entry-actions"><button className="activity-secondary" onClick={()=>beginEdit(deal)} title="Editar atividade"><Pencil size={15}/>Editar</button><button className="activity-open" onClick={()=>onOpen(deal.id)} title="Abrir ficha"><ArrowRight size={18}/></button></div>
    </article>
   }):<div className="activity-empty"><CalendarClock size={30}/><strong>Nenhuma atividade neste filtro</strong><p>{term?'Tente outro termo de pesquisa.':'As próximas ações das oportunidades aparecerão aqui automaticamente.'}</p><button onClick={()=>{setFilter('all');setTerm('')}}>Ver todas</button></div>}</div>
  </section>
  <footer className="activity-footer"><UsersRound size={14}/> As atividades estão vinculadas às oportunidades. Alterações ficam registradas no histórico comercial.</footer>
  {selected&&<div className="activity-modal-wrap"><button className="activity-modal-backdrop" onClick={()=>!busy&&setEditing(null)} aria-label="Fechar edição"/><section className="activity-modal" role="dialog" aria-modal="true" aria-labelledby="activity-dialog-heading"><div className="activity-modal-header"><div><span>ATIVIDADE COMERCIAL</span><h2 id="activity-dialog-heading">Editar próxima ação</h2><p>{selected.data.company}</p></div><button className="activity-modal-close" onClick={()=>!busy&&setEditing(null)} aria-label="Fechar"><X size={19}/></button></div><div className="activity-modal-body"><label>Próximo passo<input value={actionTitle} maxLength={160} onChange={e=>setActionTitle(e.target.value)} placeholder="Ex.: Realizar diagnóstico inicial"/></label><label>Data e horário (opcional)<input type="datetime-local" value={actionDue} onChange={e=>setActionDue(e.target.value)}/></label><label className="activity-check"><input type="checkbox" checked={actionDone} onChange={e=>setActionDone(e.target.checked)}/> Marcar como concluída</label>{error&&<p className="activity-error" role="alert">{error}</p>}</div><footer className="activity-modal-footer"><button disabled={busy} onClick={()=>setEditing(null)}>Cancelar</button><button className="activity-submit" disabled={busy||!actionTitle.trim()} onClick={save}>{busy?'Salvando…':'Salvar atividade'}</button></footer></section></div>}
 </div>;
}
