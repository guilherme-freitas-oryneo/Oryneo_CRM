import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Clock3, Highlighter, List, Maximize2, MessageSquare, Minimize2, Pause, Play, Search, Trash2, X } from 'lucide-react';
import { wordmarkLight, wordmarkDark, symbol } from './brandAssets';
import { CONTENT_VERSION, references, slides, type PlaybookSlide } from './content';
import { blockMatches, editAnnotation, loadPlaybookState, removeAnnotation, saveAnnotation, saveProgress, splitHighlights, type MarkColor, type MarkVisibility, type PlaybookAnnotation, type PlaybookSelection } from './api';
import './playbook.css';

const parts = [...new Set(slides.map(slide=>slide.part))];
const byPart = parts.map(part=>({part,items:slides.filter(slide=>slide.part===part)}));
function Diagram({slide}:{slide:PlaybookSlide}){
  if(slide.visual==='spin') return <div className="pb-diagram pb-four" aria-label="Mapa de perguntas SPIN">{['Situação','Problema','Implicação','Necessidade'].map((label,i)=><div className="pb-diagram-card" key={label}><small>0{i+1}</small><strong>{label}</strong></div>)}</div>;
  if(slide.visual==='funnel') return <div className="pb-diagram pb-funnel" aria-label="Etapas do processo comercial">{['Cadastro','Resposta','Qualificação','Reunião','Proposta','Contrato'].map((s,i)=><div key={s}><span>0{i+1}</span>{s}</div>)}</div>;
  if(slide.visual==='timeline')return <div className="pb-diagram pb-timeline" aria-label="Régua de acompanhamento">{['1h','6h','24h','72h','7 dias'].map((s,i)=><div key={s}><i/><strong>{s}</strong><small>{['Alerta','Alternativa','Explorar','Reunião','Decisão'][i]}</small></div>)}</div>;
  if(slide.visual==='pricing')return <div className="pb-diagram pb-three" aria-label="Comparação de planos">{[['Start','5 usuários'],['Growth','10 usuários'],['Scale','20 usuários']].map(([a,b])=><div className="pb-diagram-card" key={a}><small>PLANO</small><strong>{a}</strong><span>{b}</span></div>)}</div>;
  if(slide.visual==='matrix')return <div className="pb-diagram pb-matrix" aria-label="Matriz qualitativa de decisão">{['Fit comercial','Problema declarado','Momento da decisão','Capacidade de implantação'].map((a,i)=><div key={a}><span>0{i+1}</span>{a}</div>)}</div>;
  if(slide.visual==='dialogue')return <div className="pb-diagram pb-chat" aria-label="Padrão de conversa"><div>Contexto já conhecido</div><div>Questão relevante</div><div>Compromisso concreto</div></div>;
  if(slide.visual==='flow')return <div className="pb-diagram pb-three" aria-label="Fluxo comercial orientado"><div className="pb-diagram-card"><small>01</small><strong>Entender</strong></div><div className="pb-diagram-card"><small>02</small><strong>Diagnosticar</strong></div><div className="pb-diagram-card"><small>03</small><strong>Conduzir</strong></div></div>;
  return null;
}
function Selectable({slideId,blockKey,text,annotations,onPick,className=''}:{
  slideId:string;blockKey:string;text:string;annotations:PlaybookAnnotation[];
  onPick:(selection:PlaybookSelection)=>void;className?:string
}){
  const ref=useRef<HTMLParagraphElement>(null);
  const pieces=splitHighlights(text,annotations.filter(a=>a.slide_id===slideId && a.block_key===blockKey));
  const select=()=>{
    const element=ref.current, selection=window.getSelection();
    if(!element || !selection || selection.isCollapsed || !selection.rangeCount)return;
    const range=selection.getRangeAt(0);
    if(!element.contains(range.startContainer) || !element.contains(range.endContainer))return;
    try{
      const before=range.cloneRange();
      before.selectNodeContents(element);
      before.setEnd(range.startContainer,range.startOffset);
      const start=before.toString().length;
      const end=start+range.toString().length;
      if(end<=start || end>text.length || end-start>1600)return;
      const quote=text.slice(start,end);
      if(quote.trim().length===0)return;
      onPick({slide_id:slideId,block_key:blockKey,start_offset:start,end_offset:end,quote});
    }catch{ /* Ignore selections spanning non-text UI. */ }
  };
  return <p ref={ref} className={'pb-selectable '+className} onMouseUp={select} onKeyUp={select}>
    {pieces.map((piece,i)=>piece.mark?<mark className={'pb-mark pb-mark-'+piece.mark.color} key={i} title={piece.mark.note||'Trecho destacado'}>{piece.text}</mark>:<span key={i}>{piece.text}</span>)}
  </p>;
}
function useFullscreen(ref:React.RefObject<HTMLElement|null>){
  const [fullscreen,setFullscreen]=useState(false);
  useEffect(()=>{const update=()=>setFullscreen(document.fullscreenElement===ref.current);document.addEventListener('fullscreenchange',update);return()=>document.removeEventListener('fullscreenchange',update)},[ref]);
  const toggle=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await ref.current?.requestFullscreen?.()}catch{/* Browser may deny fullscreen */}};
  return {fullscreen,toggle};
}
export function PlaybookLibrary(){
  const root=useRef<HTMLDivElement>(null);
  const {fullscreen,toggle:toggleFullscreen}=useFullscreen(root);
  const [current,setCurrent]=useState(-1),[playing,setPlaying]=useState(false);
  const [showIndex,setShowIndex]=useState(true),[showNotes,setShowNotes]=useState(true);
  const [filter,setFilter]=useState('');
  const [marks,setMarks]=useState<PlaybookAnnotation[]>([]);
  const [userId,setUserId]=useState<string|null>(null);
  const [resumeId,setResumeId]=useState<string|null>(null);
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const [choice,setChoice]=useState<PlaybookSelection|null>(null);
  const [note,setNote]=useState(''),[visibility,setVisibility]=useState<MarkVisibility>('private'),[color,setColor]=useState<MarkColor>('yellow');
  const [editing,setEditing]=useState<string|null>(null),[editText,setEditText]=useState(''),[editVisibility,setEditVisibility]=useState<MarkVisibility>('private');
  const [saving,setSaving]=useState(false);
  useEffect(()=>{let active=true;void loadPlaybookState().then(data=>{if(!active)return;setUserId(data.userId);setMarks(data.annotations);setResumeId(data.lastSlide||null)}).catch(err=>{if(active)setStatus(err instanceof Error?err.message:'Não foi possível carregar as anotações.')});return()=>{active=false}},[]);
  const slide=current<0?null:slides[current];
  const slideMarks=slide?marks.filter(mark=>mark.slide_id===slide.id):[];
  const move=useCallback((next:number)=>{setCurrent(Math.max(-1,Math.min(slides.length-1,next)));setChoice(null);setNote('');setEditing(null)},[]);
  useEffect(()=>{if(current>=0&&userId)void saveProgress(userId,slides[current].id).catch(()=>setStatus('Não foi possível sincronizar o progresso.'))},[current,userId]);
  useEffect(()=>{if(!playing||current<0)return;const timer=window.setInterval(()=>setCurrent(pos=>{if(pos>=slides.length-1){setPlaying(false);return pos}return pos+1}),22000);return()=>window.clearInterval(timer)},[playing,current]);
  useEffect(()=>{
    const listener=(event:KeyboardEvent)=>{
      const node=event.target as HTMLElement;
      if(node && (node.isContentEditable||['INPUT','TEXTAREA','SELECT','BUTTON'].includes(node.tagName)))return;
      if(event.key==='ArrowRight'||event.key==='PageDown'){event.preventDefault();move(current+1)}
      if(event.key==='ArrowLeft'||event.key==='PageUp'){event.preventDefault();move(current-1)}
      if(event.code==='Space'&&current>=0){event.preventDefault();setPlaying(x=>!x)}
      if(event.key==='Escape'&&choice)setChoice(null);
    };
    window.addEventListener('keydown',listener);
    return()=>window.removeEventListener('keydown',listener);
  },[move,current,choice]);
  const start=(resume=false)=>{const found=resume?slides.findIndex(s=>s.id===resumeId):-1;move(found>=0?found:0)};
  const matching=useMemo(()=>slides.filter(s=>(s.title+' '+s.chapter+' '+s.part+' '+s.lead).toLocaleLowerCase('pt-BR').includes(filter.toLocaleLowerCase('pt-BR'))),[filter]);
  const pick=(selection:PlaybookSelection)=>{setChoice(selection);setNote('');setColor('yellow');setVisibility('private');setShowNotes(true)};
  const save=async()=>{
    if(!choice||!userId||busy)return;
    setBusy(true);setStatus('');
    try{const created=await saveAnnotation(userId,choice,note,visibility,color);setMarks(prev=>[...prev,created]);setChoice(null);setNote('');window.getSelection()?.removeAllRanges()}
    catch(err){setStatus(err instanceof Error?err.message:'Falha ao salvar marcação.')}
    finally{setBusy(false)}
  };
  const deleteMark=async(mark:PlaybookAnnotation)=>{
    if(!userId||mark.user_id!==userId||busy)return;setBusy(true);setStatus('');
    try{await removeAnnotation(mark.id,userId);setMarks(prev=>prev.filter(m=>m.id!==mark.id))}
    catch(err){setStatus(err instanceof Error?err.message:'Falha ao excluir.')}
    finally{setBusy(false)}
  };
  const saveEdit=async()=>{
    if(!userId||!editing||busy)return;setBusy(true);setStatus('');
    try{const changed=await editAnnotation(editing,userId,editText,editVisibility);setMarks(prev=>prev.map(m=>m.id===editing?changed:m));setEditing(null)}
    catch(err){setStatus(err instanceof Error?err.message:'Falha ao atualizar.')}
    finally{setBusy(false)}
  };
  const openEditor=(m:PlaybookAnnotation)=>{setEditing(m.id);setEditText(m.note);setEditVisibility(m.visibility)};
  const hasStale=slideMarks.some(m=>{const text=m.block_key==='lead'?slide?.lead:m.block_key==='decision'?slide?.decision:slide?.points[Number(m.block_key.slice(1))];return !text||!blockMatches(text,m)});
  return <div className={'pb-root'+(fullscreen?' pb-fullscreen':'')} ref={root}>
    {current===-1?<div className="pb-wait">
      <header className="pb-wait-header"><img src={wordmarkDark} alt="ORYNEO" className="pb-brand pb-brand-reverse"/><span>INTELIGÊNCIA COMERCIAL — EDIÇÃO 1.0</span></header>
      <div className="pb-wait-body"><span className="pb-eyebrow-light">APRESENTAÇÃO EM ESPERA</span><h1>Playbook<br/>Comercial.</h1><p>Estratégia, diagnóstico e condução. Um sistema de conhecimento para decisões comerciais melhores.</p><div className="pb-wait-actions"><button className="pb-start" onClick={()=>start(false)}><Play size={18} fill="currentColor"/>Iniciar apresentação</button>{resumeId&&<button className="pb-wait-resume" onClick={()=>start(true)}>Retomar no slide {resumeId}<ArrowRight size={16}/></button>}</div></div>
      <footer className="pb-wait-footer"><span>64 SLIDES · 5 PARTES · ORYNEO</span><span>Crescimento em sistema.</span></footer>
    </div>:<>
      <header className="pb-head">
        <div className="pb-head-brand"><img src={wordmarkLight} alt="ORYNEO" className="pb-brand"/><span>PLAYBOOK COMERCIAL</span></div>
        <div className="pb-head-actions"><button aria-label={showIndex?'Ocultar índice':'Mostrar índice'} onClick={()=>setShowIndex(v=>!v)}><List size={18}/><span>Índice</span></button><button aria-label={showNotes?'Ocultar anotações':'Mostrar anotações'} onClick={()=>setShowNotes(v=>!v)}><MessageSquare size={18}/><span>Anotações</span></button><button aria-label={fullscreen?'Sair da tela cheia':'Tela cheia'} onClick={()=>void toggleFullscreen()}>{fullscreen?<Minimize2 size={18}/>:<Maximize2 size={18}/>}</button></div>
      </header>
      <div className="pb-layout">
        {showIndex&&<aside className="pb-sidebar" aria-label="Índice do playbook"><div className="pb-search"><Search size={15}/><input value={filter} onChange={e=>setFilter(e.target.value)} aria-label="Buscar slides" placeholder="Buscar tema ou técnica"/></div><div className="pb-list">{byPart.map(section=><section key={section.part}><h3>{section.part}</h3>{section.items.filter(item=>matching.includes(item)).map(item=><button key={item.id} className={slide?.id===item.id?'active':''} onClick={()=>move(slides.indexOf(item))}><span>{item.id}</span><span>{item.title}</span></button>)}</section>)}{!matching.length&&<p className="pb-no-results">Nenhum slide encontrado.</p>}</div></aside>}
        <main className="pb-stage" aria-live="polite" aria-label="Apresentação comercial">
          <article className="pb-slide" key={slide?.id}>
            <div className="pb-slide-top"><span className="pb-kicker">{slide?.part} / {slide?.chapter}</span><span>{slide?.id} / {slides.length}</span></div>
            <div className="pb-slide-content">
              <div className="pb-copy"><span className="pb-eyebrow">ORYNEO / {slide?.chapter?.toUpperCase()}</span><h1>{slide?.title}</h1>{slide&&<Selectable slideId={slide.id} blockKey="lead" text={slide.lead} className="pb-lead" annotations={marks} onPick={pick}/>}<div className="pb-points">{slide?.points.map((p,i)=><div className="pb-point" key={i}><b>0{i+1}</b>{slide&&<Selectable slideId={slide.id} blockKey={'p'+i} text={p} annotations={marks} onPick={pick}/>}</div>)}</div></div>
              <div className="pb-illustration">{slide&&<Diagram slide={slide}/>}</div>
            </div>
            {slide&&<div className="pb-slide-end"><span>DECISÃO EM CAMPO</span><Selectable slideId={slide.id} blockKey="decision" text={slide.decision} annotations={marks} onPick={pick}/></div>}
            <div className="pb-slide-footer"><img src={symbol} alt="" aria-hidden="true"/><span>MAIS CONEXÕES. MAIS RESULTADO. UM SÓ SISTEMA.</span><span>EDIÇÃO {CONTENT_VERSION}</span></div>
          </article>
          {slide?.id==='64'&&<section className="pb-references" aria-label="Fontes e aulas complementares"><h2>Biblioteca de referências</h2>{references.map(r=><a key={r.url} href={r.url} rel="noopener noreferrer" target="_blank">{r.title}<ArrowRight size={13}/></a>)}</section>}
          <nav className="pb-player" aria-label="Controles de apresentação">
            <button aria-label="Voltar ao início" onClick={()=>{setPlaying(false);move(-1)}}><ArrowLeft size={17}/><span>Início</span></button>
            <div className="pb-player-center"><button aria-label="Slide anterior" disabled={current<=0} onClick={()=>move(current-1)}><ChevronLeft size={20}/></button><button className="pb-play" aria-label={playing?'Pausar reprodução automática':'Reproduzir slides automaticamente'} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={18} fill="currentColor"/>:<Play size={18} fill="currentColor"/>}</button><button aria-label="Próximo slide" disabled={current>=slides.length-1} onClick={()=>move(current+1)}><ChevronRight size={20}/></button></div>
            <div className="pb-player-count"><Clock3 size={14}/>{current+1} de {slides.length}</div>
          </nav>
          <div className="pb-progress-track" role="progressbar" aria-label="Progresso da apresentação" aria-valuenow={current+1} aria-valuemin={0} aria-valuemax={slides.length}><div style={{width:((current+1)/slides.length*100)+'%'}}/></div>
        </main>
        {showNotes&&<aside className="pb-notes" aria-label="Marcações e notas do slide">
          <div className="pb-notes-title"><div><small>CADERNO DE ESTUDO</small><h2>Suas anotações</h2></div><Highlighter size={20}/></div>
          <p className="pb-notes-explain">Selecione um trecho do slide para destacá-lo. Notas privadas ficam somente com você; notas de equipe podem ser consultadas por membros do CRM.</p>
          {status&&<p className="pb-alert" role="status">{status}</p>}
          {!choice&&slide&&<button className="pb-annotate-slide" disabled={!userId} onClick={()=>pick({slide_id:slide.id,block_key:'decision',start_offset:0,end_offset:slide.decision.length,quote:slide.decision})}>Anotar decisão deste slide <ArrowRight size={15}/></button>}
          {choice&&<div className="pb-compose">
            <div className="pb-compose-top"><strong>Nova marcação</strong><button aria-label="Cancelar marcação" onClick={()=>setChoice(null)}><X size={16}/></button></div>
            <blockquote>{choice.quote}</blockquote>
            <label>Cor do destaque <select value={color} onChange={e=>setColor(e.target.value as MarkColor)}><option value="yellow">Amarelo</option><option value="blue">Azul</option><option value="mint">Verde</option></select></label>
            <label>Visibilidade <select value={visibility} onChange={e=>setVisibility(e.target.value as MarkVisibility)}><option value="private">Somente eu</option><option value="team">Compartilhar com a equipe</option></select></label>
            <label>Anotação <textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={4000} rows={4} placeholder="O que vale lembrar ou aplicar?"/></label>
            <button className="pb-save" disabled={busy||!userId} onClick={()=>void save()}><Check size={16}/>Salvar destaque</button>
          </div>}
          <div className="pb-note-list">{slideMarks.map(m=><article className="pb-note" key={m.id}>
            <div className="pb-note-top"><span className={'pb-dot pb-dot-'+m.color}/><small>{m.visibility==='private'?'Privado':'Equipe'}{m.user_id!==userId?' · de outro membro':''}</small>{m.user_id===userId&&<button aria-label="Excluir anotação" title="Excluir anotação" disabled={busy} onClick={()=>void deleteMark(m)}><Trash2 size={14}/></button>}</div>
            <blockquote>{m.quote}</blockquote>
            {editing===m.id?<div className="pb-note-edit"><textarea value={editText} onChange={e=>setEditText(e.target.value)} maxLength={4000} rows={3}/><select value={editVisibility} onChange={e=>setEditVisibility(e.target.value as MarkVisibility)}><option value="private">Privado</option><option value="team">Equipe</option></select><div><button onClick={()=>setEditing(null)}>Cancelar</button><button disabled={busy} onClick={()=>void saveEdit()}>Salvar</button></div></div>:<>{m.note&&<p>{m.note}</p>}{m.user_id===userId&&<button className="pb-edit" onClick={()=>openEditor(m)}>Editar anotação</button>}</>}
            {hasStale&&(!slide||!blockMatches(m.block_key==='lead'?slide.lead:m.block_key==='decision'?slide.decision:slide.points[Number(m.block_key.slice(1))]||'',m))&&<span className="pb-old-note">Trecho alterado na versão atual; anotação preservada.</span>}
          </article>)}{!slideMarks.length&&!choice&&<div className="pb-empty-notes"><BookOpen size={23}/><p>Sem anotações neste slide.</p><small>Selecione texto para criar o primeiro destaque.</small></div>}</div>
        </aside>}
      </div>
    </>}
  </div>;
}
