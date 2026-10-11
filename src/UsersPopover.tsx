import {useEffect,useRef,useState} from 'react';
import {UsersRound} from 'lucide-react';
import {supabase} from './data';
import './users-popover.css';

type MemberPresence={user_id:string;display_name:string|null;directory_email:string|null;role:string;status:'active'|'suspended';avatar_path:string|null;online:boolean;last_seen_at:string|null;online_since_at:string|null;last_session_seconds:number|null};
const roleLabel:Record<string,string>={admin:'Administrador',commercial:'Comercial',support:'Suporte',viewer:'Leitura'};
const elapsed=(seconds:number)=>seconds<60?`${seconds} ${seconds===1?'segundo':'segundos'}`:seconds<3600?`${Math.floor(seconds/60)} ${Math.floor(seconds/60)===1?'minuto':'minutos'}`:seconds<86400?`${Math.floor(seconds/3600)} ${Math.floor(seconds/3600)===1?'hora':'horas'}`:`${Math.floor(seconds/86400)} ${Math.floor(seconds/86400)===1?'dia':'dias'}`;
const age=(timestamp:string|null,now:number)=>timestamp?`Visto há ${elapsed(Math.max(0,Math.floor((now-new Date(timestamp).getTime())/1000)))}`:'Nunca entrou';

export function UsersPopover(){
 const [open,setOpen]=useState(false),[members,setMembers]=useState<MemberPresence[]>([]),[error,setError]=useState(''),[now,setNow]=useState(Date.now());
 const [filter,setFilter]=useState<'all'|'online'|'active'|'suspended'>('all');
 const [avatars,setAvatars]=useState<Record<string,string>>({}),requestedPhotos=useRef(new Map<string,number>());
 useEffect(()=>{let active=true;const load=async()=>{const {data,error}=await supabase.rpc('crm_list_presence');if(!active)return;if(error)setError('Presença indisponível.');else{setMembers(data as MemberPresence[]);setError('')}};void load();const interval=setInterval(()=>void load(),open?1000:10000);return()=>{active=false;clearInterval(interval)}},[open]);
 useEffect(()=>{if(!open)return;const interval=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(interval)},[open]);
 useEffect(()=>{const ids=members.filter(m=>m.avatar_path&&now-(requestedPhotos.current.get(m.user_id+':'+m.avatar_path)||0)>25*60*1000).map(m=>m.user_id);if(!ids.length)return;for(const id of ids){const member=members.find(m=>m.user_id===id);requestedPhotos.current.set(id+':'+member?.avatar_path,now)}void supabase.functions.invoke('member-avatar',{body:{action:'read',user_ids:ids}}).then(({data})=>{if(data?.urls)setAvatars(old=>({...old,...data.urls}))})},[members,now]);
 const count=(kind:'online'|'active'|'suspended')=>members.filter(m=>kind==='online'?m.online:m.status===kind).length;
 const shown=members.filter(m=>filter==='all'||filter==='online'&&m.online||filter==='active'&&m.status==='active'||filter==='suspended'&&m.status==='suspended');
 return <div className="users-nav-wrap" onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}>
  <button type="button" className={'nav-item'+(open?' active':'')} aria-label="Usuários" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><UsersRound size={18}/><span className="nav-link-text">Usuários</span><span className="nav-counter">{count('online')}</span></button>
  {open&&<div className="users-popover" role="dialog" aria-label="Usuários do CRM"><div className="users-popover-header"><strong>Usuários</strong><span>{count('online')} online agora</span></div>
   <div className="users-popover-filters">{([['all','Todos',members.length],['online','Online',count('online')],['active','Ativos',count('active')],['suspended','Inativos',count('suspended')]] as const).map(([key,label,total])=><button key={key} className={filter===key?'selected':''} onClick={()=>setFilter(key)}>{label} <span>{total}</span></button>)}</div>
   {error?<p className="users-popover-empty" role="alert">{error}</p>:<div className="users-popover-list">{shown.length?shown.map(member=><div className="users-popover-person" key={member.user_id}><span className="users-popover-avatar">{avatars[member.user_id]?<img src={avatars[member.user_id]} alt={`Foto de ${member.display_name||member.directory_email||'usuário'}`}/>: (member.display_name||member.directory_email||'?').slice(0,1).toUpperCase()}</span><div className="users-popover-info"><strong>{member.display_name||member.directory_email||'Usuário'}</strong><small>{roleLabel[member.role]||member.role} · {member.status==='suspended'?'Inativo':member.online?'Online':'Offline'}</small><small>{member.online?`Online há ${elapsed(Math.max(0,Math.floor((now-new Date(member.online_since_at||now).getTime())/1000)))}`:age(member.last_seen_at,now)}{!member.online&&member.last_session_seconds!==null?` · Ficou online por ${elapsed(member.last_session_seconds)}`:''}</small></div><i className={member.online?'online':'offline'}/></div>):<p className="users-popover-empty">Nenhum usuário neste filtro.</p>}</div>}
  </div>}
 </div>;
}
