import {useEffect,useState} from 'react';
import {supabase} from '../data';
import '../proposal/proposal.css';
const stripePortal='https://billing.stripe.com/p/login/test_28EeVc59P4ZAccC5NQdfG00';
type Order={reference:string;company:string;customer_name:string};
export function OffboardingView({order,onRequest,busy=false,error='',done=false}:{
 order:Order;onRequest:(v:{type:'data_export'|'contract_clarification';name:string;email:string;details:string})=>void;
 busy?:boolean;error?:string;done?:boolean;
}){
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[details,setDetails]=useState('');
 const [type,setType]=useState<'data_export'|'contract_clarification'>('data_export');
 return <div className="proposal-page">
  <header><img src="../oryneo-wordmark-mono-reverse.png" alt="ORYNEO"/><span>Gestão de conta · Acesso individual</span></header>
  <main className="proposal-wrap">
   <div className="proposal-top"><small>CONTA E PRIVACIDADE</small><h1>{order.company}, suas opções de atendimento.</h1>
    <p>Pedido {order.reference}. Você pode consultar a assinatura na Stripe e solicitar uma revisão de dados ou das condições de encerramento.</p></div>
   <section className="proposal-card">
    <h2>Gerenciar cobrança e assinatura</h2>
    <p>O acesso ao portal é autenticado pela Stripe. Use o e-mail cadastrado na sua assinatura. Você pode consultar cobranças, métodos de pagamento e solicitar cancelamento no final do ciclo.</p>
    <p><a href={stripePortal} target="_blank" rel="noopener noreferrer">Abrir portal seguro de assinatura (modo teste)</a></p>
    <p className="proposal-note">Este é o ambiente de homologação. A solicitação de cancelamento na Stripe não comprova por si só a conclusão dos serviços complementares; os efeitos dependem das condições contratuais e do evento financeiro confirmado.</p>
    <div className="proposal-accept">
     <h2>Privacidade e solicitações contratuais</h2>
     <p>Uma solicitação de exportação não gera arquivo automaticamente. Nossa equipe deverá conferir a identidade e o escopo autorizado antes de disponibilizar qualquer dado.</p>
     {done?<p role="status" className="proposal-success">Solicitação registrada para análise. O atendimento continuará pelo canal autorizado.</p>:
     <form onSubmit={e=>{e.preventDefault();onRequest({type,name:name.trim(),email:email.trim().toLowerCase(),details:details.trim()})}}>
      <label htmlFor="offboard-type">Assunto</label>
      <select id="offboard-type" value={type} onChange={e=>setType(e.target.value as typeof type)}>
       <option value="data_export">Solicitar exportação dos meus dados</option>
       <option value="contract_clarification">Esclarecer condições de encerramento</option>
      </select>
      <label htmlFor="offboard-name">Nome completo</label>
      <input id="offboard-name" type="text" required minLength={2} maxLength={180} value={name} onChange={e=>setName(e.target.value)}/>
      <label htmlFor="offboard-email">E-mail vinculado à contratação</label>
      <input id="offboard-email" type="email" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/>
      <label htmlFor="offboard-details">Detalhes opcionais</label>
      <textarea id="offboard-details" maxLength={1000} value={details} onChange={e=>setDetails(e.target.value)}
       style={{display:'block',width:'100%',minHeight:110,padding:12,border:'1px solid #cbd3dc',borderRadius:8}}/>
      <button disabled={busy||name.trim().length<2||!email.includes('@')} type="submit">{busy?'Registrando…':'Registrar solicitação'}</button>
      {error&&<p role="alert" className="proposal-error">{error}</p>}
     </form>}
    </div>
    <p className="proposal-foot">Em caso de dúvidas, escreva para <a href="mailto:contato@oryneo.com.br">contato@oryneo.com.br</a>.</p>
   </section>
  </main>
 </div>;
}
export function OffboardingPage(){
 const [order,setOrder]=useState<Order|null>(null),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[done,setDone]=useState(false);
 const token=new URLSearchParams(window.location.search).get('token')||'';
 useEffect(()=>{
  if(!token){setError('O link está incompleto.');return}
  let active=true;
  supabase.functions.invoke('offboarding-public',{body:{action:'read',token}}).then(({data,error:failed})=>{
   if(!active)return;
   if(failed||!data?.ok||!data?.order)setError('Não foi possível consultar este pedido. Confira seu link ou contate a equipe.');
   else setOrder(data.order as Order);
  }).catch(()=>{if(active)setError('Consulta indisponível.')});
  return()=>{active=false};
 },[token]);
 const request=async(v:{type:'data_export'|'contract_clarification';name:string;email:string;details:string})=>{
  if(busy)return;setBusy(true);setError('');
  try{
   const {data,error:failed}=await supabase.functions.invoke('offboarding-public',{body:{action:'request',token,...v}});
   if(failed||!data?.ok)throw new Error(data?.error||'Não foi possível registrar a solicitação.');
   setDone(true);
  }catch(e){setError(e instanceof Error?e.message:'Falha ao registrar a solicitação.')}
  finally{setBusy(false)}
 };
 if(!order)return <main className="proposal-page"><div className="proposal-wrap proposal-state" role="status">{error||'Consultando pedido…'}</div></main>;
 return <OffboardingView order={order} onRequest={v=>void request(v)} busy={busy} done={done} error={error}/>;
}
