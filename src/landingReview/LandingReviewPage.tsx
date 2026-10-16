import {useEffect,useState} from 'react';
import {supabase} from '../data';
import '../proposal/proposal.css';

export type PublicLandingReview={
 version:number;status:string;company:string;customer_name:string;contact_email:string;
 preview_url:string;preview_html_sha256:string;expires_at:string;accepted_at:string|null;published_url:string|null;
};
const date=(s:string)=>new Date(s).toLocaleDateString('pt-BR',{dateStyle:'long'});
export function LandingReviewView({review,onApprove,busy=false,error=''}:{
 review:PublicLandingReview;onApprove:(value:{name:string;email:string})=>void;busy?:boolean;error?:string
}){
 const [name,setName]=useState('');
 const [email,setEmail]=useState('');
 const [consent,setConsent]=useState(false);
 const canApprove=review.status==='review';
 return <main className="proposal-page">
  <header><img src="../oryneo-wordmark-mono-reverse.png" alt="ORYNEO"/><span>Revisão de landing page · Versão {review.version}</span></header>
  <div className="proposal-wrap">
   <div className="proposal-top"><small>APROVAÇÃO DE MATERIAL DIGITAL</small>
    <h1>O projeto de {review.company} está pronto para revisão.</h1>
    <p>O aceite confirma a versão específica apresentada neste link. Alterações posteriores exigirão nova revisão.</p>
   </div>
   <section className="proposal-card" aria-label="Revisão da landing page">
    <h2>Prévia para avaliação</h2>
    <p>Destinatário: {review.customer_name} · {review.contact_email}</p>
    <p>Versão {review.version} · Prazo de avaliação até {date(review.expires_at)}</p>
    <p><a href={review.preview_url} target="_blank" rel="noopener noreferrer"
      style={{display:'inline-block',padding:'13px 20px',borderRadius:8,background:'#4357E8',color:'white',fontWeight:700,textDecoration:'none'}}>
      Abrir prévia da landing page <span aria-hidden>↗</span></a></p>
    <div className="proposal-note">
     <p>Abra a prévia e revise visual, textos, informações de contato, formulários e experiência em celular e computador.</p>
     <p>Essa aprovação não significa publicação imediata. A publicação definitiva só pode ocorrer após o aceite e uma verificação de integridade do arquivo HTML.</p>
    </div>
    {review.status==='published'?<div className="proposal-state proposal-success" role="status">
      <h3>Landing page publicada.</h3><p><a href={review.published_url||'#'} target="_blank" rel="noopener noreferrer">Abrir versão publicada</a></p>
     </div>
     :review.status==='approved'?<div className="proposal-state proposal-success" role="status">
       <h3>Versão aprovada.</h3><p>A equipe ORYNEO fará a validação final da publicação.</p>
      </div>
     :!canApprove?<div className="proposal-state" role="status"><h3>Essa revisão não está mais disponível.</h3>
       <p>Peça à equipe o link da versão atualizada.</p></div>
     :<form className="proposal-accept" onSubmit={e=>{e.preventDefault();if(consent)onApprove({name:name.trim(),email:email.trim().toLowerCase()})}}>
       <h3>Confirmar aprovação da versão {review.version}</h3>
       <label htmlFor="lp-review-name">Nome completo</label>
       <input id="lp-review-name" type="text" required minLength={2} maxLength={180} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/>
       <label htmlFor="lp-review-email">E-mail do destinatário</label>
       <input id="lp-review-email" type="email" required maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/>
       <label className="proposal-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
        <span>Abri e revisei o material apresentado, e aprovo especificamente a versão {review.version} para publicação.</span>
       </label>
       <button type="submit" disabled={busy||!consent||!name.trim()||!email.trim()}>{busy?'Registrando…':'Aprovar esta versão'}</button>
       {error&&<p className="proposal-error" role="alert">{error}</p>}
      </form>}
   </section>
   <p className="proposal-foot">ORYNEO · Revisão individual e rastreável. Este link não deve ser compartilhado com terceiros.</p>
  </div>
 </main>;
}
export function LandingReviewPage(){
 const [review,setReview]=useState<PublicLandingReview|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const token=new URLSearchParams(window.location.search).get('token')||'';
 useEffect(()=>{
  if(!token){setError('O link de revisão está incompleto.');return}
  let active=true;
  supabase.functions.invoke('landing-public',{body:{action:'read',token}}).then(({data,error:failure})=>{
   if(!active)return;
   if(failure||!data?.ok||!data?.review)setError('Não foi possível abrir a revisão. Peça um novo link à ORYNEO.');
   else setReview(data.review as PublicLandingReview);
  }).catch(()=>{if(active)setError('A consulta está indisponível.')});
  return()=>{active=false};
 },[token]);
 const approve=async(v:{name:string;email:string})=>{
  if(!review||busy)return;setBusy(true);setError('');
  try{
   const {data,error:failure}=await supabase.functions.invoke('landing-public',{body:{
    action:'accept',token,name:v.name,email:v.email,sha256:review.preview_html_sha256,consent:true
   }});
   if(failure||!data?.ok)throw new Error(data?.error||'Não foi possível registrar sua aprovação.');
   setReview(old=>old?{...old,status:'approved'}:old);
  }catch(e){setError(e instanceof Error?e.message:'Aprovação indisponível.')}
  finally{setBusy(false)}
 };
 if(!review)return <div className="proposal-page"><main className="proposal-wrap proposal-state" role="status">{error||'Abrindo revisão segura…'}</main></div>;
 return <LandingReviewView key={review.version} review={review} onApprove={v=>void approve(v)} busy={busy} error={error}/>;
}
