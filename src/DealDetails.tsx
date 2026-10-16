import {useCallback,useEffect,useState} from 'react';
import {X,Building2,UserRound,Mail,Phone,MapPin,Users,Clock3,History,FileText,Check,CalendarClock,MessageSquareText,Send,ChevronDown,Edit3,ShieldCheck,RefreshCw,Plus} from 'lucide-react';
import {supabase,mutate,money,errorText,type DealRow,type StageRow,type CompanyProfile,type Quote,type NextAction,type CrmEvent} from './data';
import './details.css';
import {ProposalAction} from './billing/ProposalAction';
import {DeliveryManager} from './delivery/DeliveryManager';
import {LandingReviewManager} from './landingReview/LandingReviewManager';
import {OffboardingManager} from './offboarding/OffboardingManager';
import {prepareBilling} from './billing/api';

const date=(value:string|null|undefined)=>{if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?'':d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})};
const clean=(v?:string|null)=>typeof v==='string'?v.trim():'';
function formatAddress(p?:CompanyProfile){
 const a=p?.address;if(!a)return '';
 const bits=[a.street,a.number,a.complement,a.district,[a.city,a.state].filter(Boolean).join(' – '),a.zip?(a.zip.replace(/\D/g,'').length===8?'CEP '+a.zip.replace(/(\d{5})(\d{3})/,'$1-$2'):'CEP '+a.zip):''].filter(Boolean);
 return bits.join(', ');
}
const currencyCapital=(value:number|null|undefined)=>typeof value==='number'&&Number.isFinite(value)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value):'';
const statusLabel=(x:string)=>x.toLowerCase().includes('ativa')?'Ativa':x;
const initials=(s:string)=>s.trim().slice(0,1).toLocaleUpperCase('pt-BR')||'O';
const fallbackCnpj=(notes:string)=>notes.match(/(?:^|\n)CNPJ:\s*([\d.\/-]{14,20})/i)?.[1]?.replace(/\D/g,'')||'';
const formatCnpj=(s:string)=>s.toUpperCase().replace(/[^A-Z0-9]/g,'').replace(/^([A-Z0-9]{2})([A-Z0-9]{3})([A-Z0-9]{3})([A-Z0-9]{4})([A-Z0-9]{2})$/,'$1.$2.$3/$4-$5');
const normalizeContact=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
function ContactLine({label,value,highlight=false}:{label:string;value?:string;highlight?:boolean}){
 if(!value)return null;
 return <div className={'cd-contact '+(highlight?'cd-contact-primary':'')}><div className="cd-contact-head"><span>{label}</span>{highlight&&<small>Informado no formulário</small>}</div><strong>{value}</strong></div>;
}
function Stat({label,value}:{label:string;value?:string|null}){if(!value)return null;return <div className="cd-stat"><span>{label}</span><strong>{value}</strong></div>}
export function DealDetails({row,stages,onClose,onEdit,onResend,onChanged}:{row:DealRow;stages:StageRow[];onClose:()=>void;onEdit:()=>void;onResend:()=>void;onChanged:()=>Promise<void>}){
 const [tab,setTab]=useState<'overview'|'history'|'proposal'>('overview');
 const [company,setCompany]=useState<CompanyProfile|null>(null);
 const [events,setEvents]=useState<CrmEvent[]>([]);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [note,setNote]=useState('');
 const [actionTitle,setActionTitle]=useState('');
 const [actionDue,setActionDue]=useState('');
 const [actionDone,setActionDone]=useState(false);
 const data=row.data,cnpj=data.company_cnpj||fallbackCnpj(data.notes||'');
 const quote=data.quote;
 const next=data.next_action??{title:'Realizar diagnóstico inicial',done:false,due_at:null};
 const refresh=useCallback(async()=>{
   setLoading(true);setError('');
   try{
    const [eventResult,companyResult]=await Promise.all([
      supabase.from('crm_events').select('id,deal_id,event_type,actor_label,detail,created_at').eq('deal_id',row.id).order('created_at',{ascending:false}).limit(300),
      cnpj?supabase.from('crm_companies').select('profile').eq('cnpj',cnpj).limit(1):Promise.resolve(null)
    ]);
    if(eventResult.error)throw eventResult.error;
    setEvents((eventResult.data||[]) as CrmEvent[]);
    if(cnpj&&companyResult&&!companyResult.error){
     let latest=(companyResult.data as {profile:CompanyProfile}[]|null)?.[0]?.profile;
     if(!latest||!Object.keys(latest).length){
      const result=await supabase.functions.invoke('company-enrich',{body:{cnpj}});
      if(!result.error&&result.data?.ok){
       const refreshed=await supabase.from('crm_companies').select('profile').eq('cnpj',cnpj).maybeSingle();
       latest=(refreshed.data?.profile as CompanyProfile|undefined)||latest;
      }
     }
     setCompany(latest&&Object.keys(latest).length?latest:(data.company_profile||null));
    }else setCompany(data.company_profile||null);
   }catch(e){setError(errorText(e));setCompany(data.company_profile||null)}
   finally{setLoading(false)}
 },[row.id,cnpj,data.company_profile]);
 useEffect(()=>{void refresh()},[refresh]);
 useEffect(()=>{setActionTitle(next.title||'Realizar diagnóstico inicial');setActionDue(next.due_at?new Date(next.due_at).toISOString().slice(0,16):'');setActionDone(!!next.done)},[row.id,row.revision]);
 const run=async(task:()=>Promise<void>)=>{
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{await task();await onChanged();await refresh();setNotice('Alteração registrada no histórico.')}
  catch(e){setError(errorText(e))}
  finally{setBusy(false)}
 };
 const submitNote=()=>void run(async()=>{if(!note.trim())return;const {error}=await supabase.rpc('crm_add_note',{p_deal_id:row.id,p_text:note.trim()});if(error)throw error;setNote('')});
 const submitAction=()=>void run(async()=>{const {error}=await supabase.rpc('crm_set_action',{p_deal_id:row.id,p_revision:row.revision,p_title:actionTitle.trim(),p_due_at:actionDue?new Date(actionDue).toISOString():null,p_done:actionDone});if(error)throw error});
 const updateStage=(stageId:string)=>void run(async()=>{if(stageId===data.stage_id)return;await mutate({...row,data:{...data,stage_id:stageId}})});
 const logDescription=(e:CrmEvent)=>{
  const d=e.detail||{};
  if(e.event_type==='received')return 'Solicitação recebida'+(d.plan?' · Plano '+d.plan:'')+'.';
  if(e.event_type==='stage_changed')return 'Etapa alterada de '+(stages.find(s=>s.id===d.from)?.data.name||'etapa anterior')+' para '+(stages.find(s=>s.id===d.to)?.data.name||'nova etapa')+'.';
  if(e.event_type==='value_changed')return 'Valor negociado alterado de '+money(Number(d.from||0))+' para '+money(Number(d.to||0))+'.';
  if(e.event_type==='note')return String(d.text||'Nota registrada.');
  if(e.event_type==='action_changed')return 'Próxima ação: '+String((d.after as NextAction|undefined)?.title||'Atualizada')+((d.after as NextAction|undefined)?.done?' · Concluída':' · Pendente');
  if(e.event_type==='reconciled')return 'Registro histórico conciliado sem criar outra oportunidade.';
  if(e.event_type==='email_sent')return (d.resend?'E-mail reenviado':'Primeiro e-mail enviado')+(d.internet_message_id?' · '+String(d.internet_message_id):'')+'.';
  return String(d.text||'Informações da oportunidade atualizadas.');
 };
 const eventTitle=(kind:string)=>({received:'Oportunidade recebida',stage_changed:'Etapa do funil alterada',value_changed:'Valor atualizado',note:'Anotação comercial',action_changed:'Próxima ação atualizada',reconciled:'Dados da proposta conciliados',details_changed:'Ficha atualizada',activity:'Atividade registrada',email_sent:'Contato por e-mail'} as Record<string,string>)[kind]||'Atualização';
 const fullAddress=formatAddress(company||undefined);
 const qsa=company?.qsa||[];
 return <div className="cd-root"><button aria-label="Fechar ficha" className="cd-backdrop" onClick={onClose}/><section className="cd-panel" role="dialog" aria-modal="true" aria-label="Ficha da oportunidade">
   <header className="cd-top"><span><Building2 size={16}/> DETALHES DA OPORTUNIDADE</span><button className="cd-close" onClick={onClose} aria-label="Fechar ficha"><X size={20}/></button></header>
   <div className="cd-scroll">
    <div className="cd-lead-heading"><div className="cd-lead-icon">{initials(data.company)}</div><div><small>Recebido pela {data.source||'equipe ORYNEO'} · {date(row.created_at)}</small><h2>{quote?.plan?quote.plan+(quote.addons?.length?' + '+quote.addons.map(a=>a.label).join(' + '):''):data.title}</h2><p>{data.company} · ID {row.id.slice(0,8)}</p></div></div>
    <div className="cd-status"><label>Etapa do funil<select value={data.stage_id} disabled={busy} onChange={e=>updateStage(e.target.value)}>{stages.map(s=><option value={s.id} key={s.id}>{s.data.name}</option>)}</select></label><button type="button" onClick={onEdit}><Edit3 size={15}/>Editar dados</button></div>
    <section className="cd-financial"><div className="cd-financial-top"><span>VALOR EM NEGOCIAÇÃO</span><strong>{money(data.value_cents||0)}</strong><small>Seleção comercial apresentada pelo lead</small></div>
    {quote&&<div className="cd-price-lines"><div><span>Assinatura {quote.cycle==='annual'?'anual':'mensal'}</span><b>{money(quote.period_cents)}</b></div><div><span>Implantação</span><b>{money(quote.setup_cents)}</b></div>{quote.addons?.map(a=><div key={a.key}><span>{a.label}{a.key==='traffic'?' · compromisso trimestral':''}</span><b>{money(a.upfront_cents)}</b></div>)}</div>}
    <button className="cd-link" onClick={()=>setTab('proposal')}>Conferir proposta comercial <ChevronDown size={15}/></button></section>
    <div className="cd-tabs" role="tablist" aria-label="Seções da oportunidade">{([['overview','Visão geral'],['history','Histórico'],['proposal','Proposta']] as const).map(([key,label])=><button key={key} role="tab" aria-selected={tab===key} className={tab===key?'active':''} onClick={()=>setTab(key)}>{label}{key==='history'&&events.length>0&&<span>{events.length}</span>}</button>)}</div>
    {error&&<p role="alert" className="cd-error">{error}</p>}{notice&&<p role="status" className="cd-success">{notice}</p>}
    {tab==='overview'&&<div className="cd-content">
      {(data.form_submission?.team_size||data.form_submission?.acquisition_channel||(data.form_submission?.acquisition_channels||[]).length||(data.form_submission?.goals||[]).length||data.form_submission?.intent)&&<section className="cd-diagnosis" aria-label="Diagnóstico inicial do lead">
       <div className="cd-diagnosis-head"><div><small>QUALIFICAÇÃO COMERCIAL</small><h3><FileText size={17}/>Diagnóstico inicial</h3><p>Respostas declaradas pelo lead na landing page para orientar a primeira abordagem.</p></div><span>Formulário</span></div>
       <div className="cd-diagnosis-content">
         {(data.form_submission?.team_size||data.form_submission?.acquisition_channel||(data.form_submission?.acquisition_channels||[]).length>0)&&<div className="cd-diagnosis-grid">
          {data.form_submission?.team_size&&<div className="cd-diagnosis-stat"><Users size={17}/><small>Tamanho da equipe comercial</small><strong>{data.form_submission.team_size}</strong></div>}
          {(data.form_submission?.acquisition_channels?.length||data.form_submission?.acquisition_channel)&&<div className="cd-diagnosis-stat"><Building2 size={17}/><small>Canais atuais de aquisição</small><strong>{data.form_submission?.acquisition_channels?.join(' · ')||data.form_submission?.acquisition_channel}{data.form_submission?.primary_acquisition_channel&&(data.form_submission.acquisition_channels?.length??0)>1?<><br/><em>Principal: {data.form_submission.primary_acquisition_channel}</em></>:null}</strong></div>}
         </div>}
         {(data.form_submission?.goals||[]).length>0&&<div className="cd-diagnosis-interests"><strong>Objetivos e interesses selecionados</strong><div className="cd-diagnosis-goals">{data.form_submission?.goals?.map((goal,i)=><span key={i}><Check size={13}/>{goal}{goal===data.form_submission?.primary_goal?<small>Prioridade</small>:null}</span>)}</div></div>}
         {data.form_submission?.intent&&<div className="cd-diagnosis-intent"><span>Intenção declarada</span><strong>{data.form_submission.intent==='contract'?'Quero contratar':data.form_submission.intent==='conversation'?'Quero conversar':data.form_submission.intent}</strong></div>}
       </div>
      </section>}
      <section className="cd-company"><div className="cd-company-head"><div className="cd-company-mark"><Building2 size={18}/></div><div><small>IDENTIFICAÇÃO EMPRESARIAL</small><h3>{company?.legal_name||data.company}</h3>{company?.trade_name&&company.trade_name!==company.legal_name&&<p>{company.trade_name}</p>}</div>{company?.status&&<span className="cd-active">{statusLabel(company.status)}</span>}</div>
       <div className="cd-grid">
        <Stat label="CNPJ" value={cnpj?formatCnpj(cnpj):''}/>
        <Stat label="Capital social" value={currencyCapital(company?.capital)}/>
        <Stat label="Abertura" value={company?.opened_at||''}/>
        <Stat label="Natureza jurídica" value={company?.legal_form||''}/>
        <Stat label="Atividade principal" value={company?.main_activity||''}/>
       </div>
       {!company&&<p className="cd-muted">O cadastro empresarial complementar ainda não foi retornado. O contato e a proposta permanecem disponíveis.</p>}
      </section>
      <section><h3 className="cd-section-title"><UserRound size={17}/>Responsável pelo contato</h3><div className="cd-person"><div className="cd-person-avatar">{initials(data.contact)}</div><div><strong>{data.contact||'Não informado'}</strong><span>Responsável informado no formulário</span><small>Não necessariamente integrante do quadro societário</small></div></div></section>
      <section><h3 className="cd-section-title"><Phone size={17}/>Canais de contato</h3><div className="cd-contact-grid"><ContactLine label="E-mail" value={data.email} highlight/><ContactLine label="E-mail cadastral" value={normalizeContact(data.email)!==normalizeContact(company?.email||'')?company?.email:undefined}/><ContactLine label="Celular / WhatsApp" value={data.phone} highlight/><ContactLine label="Telefone cadastral" value={normalizeContact(data.phone)!==normalizeContact(company?.phone||'')?company?.phone:undefined}/></div></section>
      {fullAddress&&<section><h3 className="cd-section-title"><MapPin size={17}/>Endereço da empresa</h3><div className="cd-address"><MapPin size={18}/><p>{fullAddress}</p><button onClick={()=>void navigator.clipboard.writeText(fullAddress).then(()=>setNotice('Endereço copiado.')).catch(()=>setError('Não foi possível copiar o endereço.'))}>Copiar</button></div></section>}
      {!!qsa.length&&<section><h3 className="cd-section-title"><Users size={17}/>Quadro societário <span>{qsa.length}</span></h3><div className="cd-partners">{qsa.map((s,i)=><div className="cd-partner" key={i}><div className="cd-person-avatar">{initials(s.name)}</div><div><strong>{s.name}</strong><span>{s.qualification||'Integrante do quadro societário'}</span></div></div>)}</div></section>}
      {data.first_contact&&<section><h3 className="cd-section-title"><Mail size={17}/>Primeiro contato</h3><div className="cd-action-summary cd-first-contact"><strong>E-mail enviado</strong><span>{date(data.first_contact.sent_at)}</span><button type="button" onClick={onResend}>Revisar e reenviar</button></div></section>}
      <section><h3 className="cd-section-title"><CalendarClock size={17}/>Próxima ação comercial</h3><div className="cd-action-summary"><strong>{next.title}</strong><span>{next.done?'Concluída':'Pendente'}{next.due_at?' · '+date(next.due_at):' · Prazo a definir'}</span><button onClick={()=>setTab('history')}>Gerenciar ação</button></div></section>
      
     </div>}
    {tab==='history'&&<div className="cd-content">
      <section className="cd-action-editor"><h3 className="cd-section-title"><CalendarClock size={17}/>Próxima ação</h3><label>O que precisa acontecer?<input value={actionTitle} onChange={e=>setActionTitle(e.target.value)} maxLength={160}/></label><label>Prazo, se já definido<input type="datetime-local" value={actionDue} onChange={e=>setActionDue(e.target.value)}/></label><label className="cd-check"><input type="checkbox" checked={actionDone} onChange={e=>setActionDone(e.target.checked)}/>Marcar como concluída</label><button className="cd-primary" disabled={busy||!actionTitle.trim()} onClick={submitAction}><Check size={16}/>Salvar próxima ação</button></section>
      <section><h3 className="cd-section-title"><MessageSquareText size={17}/>Registrar anotação</h3><textarea value={note} maxLength={3000} onChange={e=>setNote(e.target.value)} placeholder="O que foi conversado? Registre contexto, objeções e próximos passos." rows={4}/><button className="cd-primary" disabled={busy||!note.trim()} onClick={submitNote}><Send size={15}/>Salvar nota</button></section>
      <section><h3 className="cd-section-title"><History size={17}/>Linha do tempo</h3>{loading?<p className="cd-muted">Carregando histórico…</p>:!events.length?<p className="cd-muted">Nenhum evento registrado ainda. As próximas mudanças aparecerão aqui.</p>:<div className="cd-timeline">{events.map(e=><article key={e.id}><div className="cd-timeline-dot"/><div><h4>{eventTitle(e.event_type)}</h4><p>{logDescription(e)}</p><footer><span>{e.actor_label||'Sistema ORYNEO'}</span> · {date(e.created_at)}</footer></div></article>)}</div>}</section>
     </div>}
    {tab==='proposal'&&<div className="cd-content"><section><h3 className="cd-section-title"><FileText size={17}/>Solicitação comercial</h3>{quote?<div className="cd-proposal"><div><small>PLANO SELECIONADO</small><h3>{quote.plan} <span>· {quote.cycle==='annual'?'Anual':'Mensal'}</span></h3></div><dl><div><dt>Assinatura {quote.cycle==='annual'?'anual':'mensal'}</dt><dd>{money(quote.period_cents)}</dd></div><div><dt>Implantação única</dt><dd>{money(quote.setup_cents)}</dd></div>{quote.addons.map(a=><div key={a.key}><dt>{a.label}</dt><dd>{money(a.upfront_cents)}</dd></div>)}</dl><div className="cd-proposal-total"><span>Total da seleção</span><strong>{money(data.value_cents)}</strong></div></div>:<div className="cd-proposal"><p className="cd-muted">Detalhamento anterior registrado nas observações originais da oportunidade.</p><pre>{data.notes||'Sem observações.'}</pre><div className="cd-proposal-total"><span>Em negociação</span><strong>{money(data.value_cents)}</strong></div></div>}</section><p className="cd-muted"><ShieldCheck size={15}/> Valor indicado pelo lead, ainda não uma venda concluída.</p>{quote&&<ProposalAction dealId={row.id} canPrepare={!busy} onPrepareBilling={()=>prepareBilling(row.id)}/>}{quote&&<DeliveryManager dealId={row.id}/>} {quote&&<LandingReviewManager dealId={row.id}/>} {quote&&<OffboardingManager dealId={row.id}/>}</div>}
   </div><footer className="cd-footer"><span><ShieldCheck size={15}/> Histórico e dados protegidos por acesso ao CRM</span><button onClick={()=>void refresh()} aria-label="Atualizar ficha"><RefreshCw size={15}/></button><button onClick={onClose}>Fechar ficha</button></footer>
  </section></div>;
}
