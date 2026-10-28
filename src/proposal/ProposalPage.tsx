import {useEffect,useState} from 'react';
import {Printer} from 'lucide-react';
import { TermsDialog } from '../legal/TermsDialog';
import {supabase} from '../data';
import './proposal.css';

export type ProposalSnapshot={
 schema:string;catalog_version:string;plan:string;cycle:string;
 items:Array<{key:string;label:string;detail:string;amount_cents:number;recurring:boolean}>;
 amount_total:number;addons:string[];
 recurring:{label:string;amount_cents:number;interval_label:string};
 traffic_renewal_amount_cents:number|null;traffic_renewal_interval:string;
 media_budget_included:boolean;notice:string;
 presentation?:{
  schema:'oryneo.proposal-presentation.v1';primary_goal:string;
  items:Array<{key:'platform'|'implementation'|'landing-page'|'traffic';eyebrow:string;title:string;summary:string;bullets:string[];commercial_detail:string}>;
  journey:Array<{key:'acceptance'|'payment'|'implementation'|'additional-services';title:string;description:string}>;
 };
};
export type PublicProposal={
 version:number;status:string;company:string;customer_name:string;contact_email:string;
 expires_at:string;accepted_at:string|null;snapshot:ProposalSnapshot;snapshot_sha256:string
};
const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
const date=(x:string)=>new Date(x).toLocaleString('pt-BR',{dateStyle:'long',timeStyle:'short'});
export function ProposalView({proposal,onAccept,busy=false,error=''}:{
 proposal:PublicProposal;onAccept:(values:{name:string;email:string})=>void;busy?:boolean;error?:string;
}){
 const [name,setName]=useState('');
 const [email,setEmail]=useState('');
 const [consent,setConsent]=useState(false);
 const canAccept=proposal.status==='sent';
 const accepted=proposal.status==='accepted';
 const s=proposal.snapshot;
 return <div className="proposal-page">
  <header><img src="../oryneo-wordmark-mono-reverse.png" alt="ORYNEO"/><span>Proposta comercial individual · versão {proposal.version}</span></header>
  <main className="proposal-wrap">
   <div className="proposal-top"><small>PROPOSTA INDIVIDUAL · ORYNEO</small><h1>Uma proposta feita para {proposal.company}.</h1>
    <p>Revise as condições abaixo antes de aceitar. Esta proposta é individual, com prazo e versão definidos.</p>
    <button className="proposal-print-action" type="button" onClick={()=>window.print()}><Printer size={17}/>Imprimir ou salvar em PDF</button>
   </div>
   <article className="proposal-card">
    <h2>Plano {s.plan} · {s.cycle==='annual'?'Anual':'Mensal'}</h2>
    <p>Destinatário: {proposal.customer_name} · {proposal.contact_email}</p>
    <p>Versão {proposal.version} · Validade até {date(proposal.expires_at)}</p>
    {s.presentation?.schema==='oryneo.proposal-presentation.v1'&&<>
     {s.presentation.primary_goal&&<section className="proposal-priority" aria-label="Prioridade informada"><small>PRIORIDADE INFORMADA</small><strong>{s.presentation.primary_goal}</strong></section>}
     <section className="proposal-deliverables" aria-labelledby="proposal-deliverables-title">
      <div className="proposal-section-heading"><small>ESCOPO MATERIALIZADO</small><h2 id="proposal-deliverables-title">O que está incluído</h2><p>Cada bloco abaixo corresponde a um item desta versão.</p></div>
      <div className="proposal-deliverable-grid">{s.presentation.items.map(item=><article className={`proposal-deliverable proposal-deliverable-${item.key}`} key={item.key}>
       <small>{item.eyebrow}</small><h3>{item.title}</h3><strong>{item.commercial_detail}</strong><p>{item.summary}</p>
       <ul>{item.bullets.map((bullet,index)=><li key={index}>{bullet}</li>)}</ul>
      </article>)}</div>
     </section>
     <section className="proposal-journey" aria-labelledby="proposal-journey-title">
      <div className="proposal-section-heading"><small>PRÓXIMOS PASSOS</small><h2 id="proposal-journey-title">Como a contratação ganha forma</h2></div>
      <ol>{s.presentation.journey.map((step,index)=><li key={step.key}><span>{String(index+1).padStart(2,'0')}</span><div><strong>{step.title}</strong><p>{step.description}</p></div></li>)}</ol>
     </section>
    </>}
    <section className="proposal-investment" aria-labelledby="proposal-investment-title"><div className="proposal-section-heading"><small>CONDIÇÕES COMERCIAIS</small><h2 id="proposal-investment-title">Composição do investimento</h2></div>
    <table><thead><tr><th scope="col">Composição da contratação</th><th scope="col">Valor inicial</th></tr></thead>
     <tbody>{s.items.map((item)=><tr key={item.key}><td><strong>{item.label}</strong><div>{item.detail}</div></td>
      <td>{money(item.amount_cents)}</td></tr>)}</tbody>
    </table>
    <div className="proposal-sum"><span>Total no primeiro pagamento</span><strong>{money(s.amount_total)}</strong></div>
    <div className="proposal-note">
     <p><strong>Assinatura recorrente:</strong> {money(s.recurring.amount_cents)} {s.recurring.interval_label}.</p>
     {s.traffic_renewal_amount_cents!=null&&<p><strong>Tráfego pago:</strong> {money(s.traffic_renewal_amount_cents)} {s.traffic_renewal_interval}. A verba de mídia é cobrada separadamente.</p>}
     <p>{s.notice}</p>
     <p>O pagamento será oferecido em uma etapa separada, após o registro do aceite. Nenhum valor é cobrado nesta página.</p>
    </div>
    </section>
    {accepted?<div className="proposal-state proposal-success" role="status">
     <h3>Aceite registrado.</h3><p>Esta versão foi aceita em {proposal.accepted_at?date(proposal.accepted_at):'data registrada no sistema'}.</p><p>A equipe ORYNEO encaminhará o link de pagamento quando o pedido estiver preparado.</p>
    </div>:!canAccept?<div className="proposal-state" role="status">
     <h3>Esta proposta não está disponível para novo aceite.</h3>
     <p>O link expirou ou foi substituído por uma versão mais recente. Solicite o link atualizado à equipe ORYNEO.</p>
    </div>:<form className="proposal-accept" onSubmit={(event)=>{event.preventDefault();if(consent)onAccept({name:name.trim(),email:email.trim().toLowerCase()})}}>
     <h3>Confirmar aceite desta versão</h3>
     <p>Identifique-se como destinatário. O sistema registrará a versão e a data da sua confirmação.</p>
     <label htmlFor="proposal-accept-name">Nome completo</label>
     <input id="proposal-accept-name" type="text" autoComplete="name" required minLength={2} maxLength={180}
      value={name} onChange={event=>setName(event.target.value)}/>
     <label htmlFor="proposal-accept-email">E-mail destinatário da proposta</label>
     <input id="proposal-accept-email" type="email" autoComplete="email" required maxLength={254}
      value={email} onChange={event=>setEmail(event.target.value)}/>
     <label className="proposal-check"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/>
      <span>Li e concordo com a versão {proposal.version}, os itens, o valor do primeiro pagamento e os ciclos de cobrança apresentados.</span></label>
     <div className="proposal-terms-access"><TermsDialog label="Consultar os Termos Gerais de Contratação" /></div>
     <button disabled={busy||!consent||!name.trim()||!email.trim()} type="submit">{busy?'Registrando…':'Aceitar esta versão'}</button>
     {error&&<p className="proposal-error" role="alert">{error}</p>}
    </form>}
   </article>
   <footer className="proposal-foot">ORYNEO · Crescimento em sistema. Não compartilhe este link: ele permite consultar as condições individuais da sua empresa.</footer>
  </main>
 </div>;
}
export function ProposalPage(){
 const [proposal,setProposal]=useState<PublicProposal|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const token=new URLSearchParams(window.location.search).get('token')||'';
 useEffect(()=>{
  if(!token){setError('O link da proposta está incompleto.');return}
  let active=true;
  supabase.functions.invoke('proposal-public',{body:{action:'read',token}}).then(({data,error:failure})=>{
   if(!active)return;
   if(failure||!data?.ok||!data?.proposal)setError('Não foi possível abrir esta proposta. Confirme o endereço ou solicite um novo link.');
   else setProposal(data.proposal as PublicProposal);
  }).catch(()=>{if(active)setError('O serviço de propostas não está disponível no momento.')});
  return()=>{active=false};
 },[token]);
 const accept=async(values:{name:string;email:string})=>{
  if(!proposal||busy)return;
  setBusy(true);setError('');
  try{
   const {data,error:failure}=await supabase.functions.invoke('proposal-public',{body:{
    action:'accept',token,name:values.name,email:values.email,
    snapshot_sha256:proposal.snapshot_sha256,consent:true
   }});
   if(failure||!data?.ok)throw new Error(data?.error||'Não foi possível confirmar o aceite.');
   setProposal(p=>p?{...p,status:'accepted',accepted_at:new Date().toISOString()}:p);
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível registrar o aceite.')}
  finally{setBusy(false)}
 };
 if(!proposal)return <div className="proposal-page"><main className="proposal-wrap proposal-loading" role="status">{error||'Carregando proposta segura…'}</main></div>;
 return <ProposalView key={proposal.version} proposal={proposal} onAccept={v=>void accept(v)} busy={busy} error={error}/>;
}
