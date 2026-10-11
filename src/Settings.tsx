import {useEffect,useState} from 'react';
import {ShieldCheck,Users,RefreshCw} from 'lucide-react';
import {supabase,errorText} from './data';
import {prepareAvatar} from './avatar';
import './settings.css';

type Role='admin'|'commercial'|'support'|'viewer';
type Member={user_id:string;display_name:string|null;directory_email:string|null;role:Role;status:'active'|'suspended';created_at:string};
const labels:Record<Role,string>={admin:'Administrador',commercial:'Comercial',support:'Suporte',viewer:'Leitura'};
const matrix=[
 ['Gerenciar usuários e configurações','Sim','—','—','—'],
 ['Ver oportunidades','Todas','Atribuídas','Atribuídas','Atribuídas'],
 ['Valores e propostas','Todas','Atribuídas','—','—'],
 ['Editar oportunidades','Sim','Atribuídas','—','—'],
 ['Notas e próximas ações','Sim','Atribuídas','Atribuídas','—'],
 ['Caixa postal pessoal','Própria','—','—','—']
];

export function Settings({role,email,userId}:{role:Role;email:string;userId:string}){
 const [members,setMembers]=useState<Member[]>([]),[loading,setLoading]=useState(role==='admin');
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[saving,setSaving]=useState<string|null>(null);
 const [inviteEmail,setInviteEmail]=useState(''),[inviteName,setInviteName]=useState(''),[inviteRole,setInviteRole]=useState<Role>('commercial'),[inviting,setInviting]=useState(false);
 const [newPassword,setNewPassword]=useState(''),[confirmPassword,setConfirmPassword]=useState(''),[verificationCode,setVerificationCode]=useState(''),[codeSent,setCodeSent]=useState(false),[changingPassword,setChangingPassword]=useState(false);
 const [avatarUrl,setAvatarUrl]=useState<string|null>(null),[uploadingAvatar,setUploadingAvatar]=useState(false);
 const load=async()=>{
  if(role!=='admin')return;
  setLoading(true);setError('');
  const {data,error}=await supabase.rpc('crm_list_members');
  if(error)setError(error.message);else setMembers(data as Member[]);
  setLoading(false);
 };
 useEffect(()=>{void load()},[role]);
 useEffect(()=>{void supabase.functions.invoke('member-avatar',{body:{action:'read',user_ids:[userId]}}).then(({data})=>{if(data?.urls?.[userId])setAvatarUrl(data.urls[userId])})},[userId]);
 const save=async(member:Member)=>{
  setSaving(member.user_id);setError('');setNotice('');
  const {error}=await supabase.rpc('crm_set_member',{
   p_user_id:member.user_id,p_role:member.role,p_status:member.status,p_display_name:member.display_name||''
  });
  if(error)setError(errorText(error));else{setNotice('Permissões atualizadas.');await load()}
  setSaving(null);
 };
 const update=(id:string,change:Partial<Member>)=>setMembers(items=>items.map(m=>m.user_id===id?{...m,...change}:m));
 const invite=async()=>{
  setInviting(true);setError('');setNotice('');
  const {data,error}=await supabase.functions.invoke('member-invite',{body:{email:inviteEmail.trim(),name:inviteName.trim(),role:inviteRole}});
  if(error||!data?.ok)setError(data?.error||errorText(error));
  else{setNotice(data.invited?'Convite enviado. A pessoa poderá definir a senha e entrar no CRM.':'Conta existente vinculada à equipe.');setInviteEmail('');setInviteName('');await load()}
  setInviting(false);
 };
 const requestPasswordCode=async()=>{
  if(newPassword.length<12||newPassword!==confirmPassword){setError('As senhas precisam coincidir e ter pelo menos 12 caracteres.');return}
  setChangingPassword(true);setVerificationCode('');setError('');setNotice('');
  const {error}=await supabase.auth.reauthenticate();
  if(error)setError('Não foi possível enviar o código de confirmação. Tente novamente.');
  else{setCodeSent(true);setNotice('Enviamos um código de confirmação para seu e-mail cadastrado.')}
  setChangingPassword(false);
 };
 const changePassword=async()=>{
  if(newPassword!==confirmPassword||verificationCode.trim().length<6){setError('Confira as senhas e o código recebido por e-mail.');return}
  setChangingPassword(true);setError('');setNotice('');
  const {error}=await supabase.auth.updateUser({password:newPassword,nonce:verificationCode.trim()});
  if(error)setError('Não foi possível confirmar a troca. Confira o código e tente novamente.');else{setNewPassword('');setConfirmPassword('');setVerificationCode('');setCodeSent(false);setNotice('Senha atualizada com segurança.')}
  setChangingPassword(false);
 };
 const uploadAvatar=async(file:File)=>{
  setUploadingAvatar(true);setError('');setNotice('');
  try{const image=await prepareAvatar(file);const {data,error}=await supabase.functions.invoke('member-avatar',{body:{action:'upload',image}});if(error||!data?.ok)throw new Error(data?.error||'Não foi possível enviar a foto.');setAvatarUrl(data.url||null);setNotice('Foto de perfil atualizada.')}catch(e){setError(errorText(e))}
  finally{setUploadingAvatar(false)}
 };
 return <div className="settings-page">
  <div className="settings-heading"><span>CONFIGURAÇÕES</span><h1>Equipe e permissões</h1><p>Acesso vinculado à conta de cada pessoa e aplicado no banco de dados.</p></div>
  <section className="settings-card"><h2><ShieldCheck size={19}/>Meu acesso</h2><div className="settings-profile"><span className="settings-profile-avatar">{avatarUrl?<img src={avatarUrl} alt="Sua foto de perfil"/>:email.slice(0,1).toUpperCase()}</span><div><p><strong>{email}</strong> · {labels[role]}</p><label className="settings-photo-upload">{uploadingAvatar?'Enviando foto…':'Alterar foto de perfil'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadingAvatar} onChange={e=>{const file=e.target.files?.[0];if(file)void uploadAvatar(file);e.target.value=''}}/></label></div></div></section>
  <section className="settings-card"><h2>Minha senha</h2><p>Defina uma senha pessoal. A confirmação é enviada ao seu e-mail cadastrado.</p><div className="settings-invite settings-password"><label>Nova senha<input type="password" autoComplete="new-password" value={newPassword} onChange={e=>{setNewPassword(e.target.value);setCodeSent(false)}} minLength={12} placeholder="Mínimo de 12 caracteres"/></label><label>Confirmar nova senha<input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>{setConfirmPassword(e.target.value);setCodeSent(false)}} minLength={12} placeholder="Repita a nova senha"/></label>{codeSent?<><label>Código recebido por e-mail<input inputMode="numeric" autoComplete="one-time-code" value={verificationCode} onChange={e=>setVerificationCode(e.target.value)} maxLength={12} placeholder="Código de confirmação"/></label><button onClick={()=>void changePassword()} disabled={changingPassword||verificationCode.trim().length<6}>{changingPassword?'Confirmando…':'Definir senha'}</button></>:<button onClick={()=>void requestPasswordCode()} disabled={changingPassword||newPassword.length<12||newPassword!==confirmPassword}>{changingPassword?'Enviando…':'Enviar código'}</button>}</div></section>
  {role==='admin'&&<section className="settings-card"><div className="settings-card-title"><div><h2><Users size={19}/>Usuários do CRM</h2><p>Altere o papel ou suspenda o acesso de uma conta existente.</p></div><button onClick={()=>void load()} disabled={loading} aria-label="Atualizar usuários"><RefreshCw size={16}/></button></div>
   {loading?<p>Carregando usuários…</p>:<div className="settings-users">{members.map(member=><div className="settings-user" key={member.user_id}>
    <div><strong>{member.display_name||member.directory_email||member.user_id}</strong><small>{member.directory_email||member.user_id}</small></div>
    <label>Papel<select aria-label={`Papel de ${member.directory_email||member.user_id}`} value={member.role} onChange={e=>update(member.user_id,{role:e.target.value as Role})}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label>Status<select aria-label={`Status de ${member.directory_email||member.user_id}`} value={member.status} onChange={e=>update(member.user_id,{status:e.target.value as Member['status']})}><option value="active">Ativo</option><option value="suspended">Suspenso</option></select></label>
    <button onClick={()=>void save(member)} disabled={saving===member.user_id}>Salvar</button>
   </div>)}</div>}
   <p className="settings-hint">A conta administradora inicial é protegida contra suspensão ou rebaixamento se for a última administradora ativa.</p>
  </section>}
  {role==='admin'&&<section className="settings-card"><h2>Adicionar pessoa</h2><p>O convite é enviado por e-mail. Cada pessoa terá login e senha próprios.</p><div className="settings-invite"><label>Nome<input value={inviteName} onChange={e=>setInviteName(e.target.value)} maxLength={120} placeholder="Nome da pessoa"/></label><label>E-mail<input type="email" value={inviteEmail} onChange={e=>setInviteEmail(e.target.value)} maxLength={254} placeholder="nome@empresa.com"/></label><label>Papel<select value={inviteRole} onChange={e=>setInviteRole(e.target.value as Role)}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button onClick={()=>void invite()} disabled={inviting||!inviteEmail.includes('@')}>{inviting?'Enviando…':'Enviar convite'}</button></div></section>}
  <section className="settings-card"><h2>O que cada papel pode fazer</h2><div className="settings-matrix-wrap"><table className="settings-matrix"><thead><tr><th>Permissão</th><th>Administrador</th><th>Comercial</th><th>Suporte</th><th>Leitura</th></tr></thead><tbody>{matrix.map(row=><tr key={row[0]}>{row.map((cell,i)=>i===0?<th key={i}>{cell}</th>:<td key={i}>{cell}</td>)}</tr>)}</tbody></table></div><p className="settings-hint">Uma oportunidade sem responsável fica disponível somente para administradores. A caixa postal não é compartilhada por papel.</p></section>
  <section className="settings-card"><h2>Calendário comercial</h2><p>Segunda a sexta, das 9h às 18h (horário de São Paulo). Feriados nacionais fora do expediente; pontos facultativos e feriados locais não entram no cálculo.</p><p className="settings-hint">As metas de prazo por etapa ainda precisam de valores definidos.</p></section>
  {error&&<p role="alert" className="settings-error">{error}</p>}{notice&&<p role="status" className="settings-notice">{notice}</p>}
 </div>;
}
