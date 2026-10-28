import {useEffect,useState} from 'react';
import {supabase} from '../data';
import './delivery.css';

type MilestoneState='pending'|'in_progress'|'completed'|'blocked';
export type DeliveryMilestone={id:string;position:number;title:string;state:MilestoneState;
 due_at:string|null;note:string|null;completed_at:string|null;updated_at:string};
export type DeliveryRecord={
 order:{reference:string;company:string;customer_name:string;plan:string};
 project:{status:string;started_at:string|null;completed_at:string|null;created_at:string;updated_at:string};
 milestones:DeliveryMilestone[];
};
const date=(v:string)=>new Date(v).toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
const stateLabel:Record<MilestoneState,string>={pending:'Aguardando início',in_progress:'Em andamento',completed:'Concluído',blocked:'Aguardando informações'};
export function DeliveryView({record}:{record:DeliveryRecord}){
 const {order,project,milestones}=record;
 return <div className="delivery-page">
  <header><img src="../oryneo-wordmark-mono-reverse.png" alt="ORYNEO"/><small>Área de implantação · Acesso individual</small></header>
  <main className="delivery-shell">
   <small style={{color:'#4357e8',fontWeight:700,letterSpacing:1.4}}>JORNADA DE IMPLANTAÇÃO</small>
   <h1>{order.company}, acompanhe os próximos passos.</h1>
   <p className="delivery-intro">Pedido {order.reference} · Plano {order.plan}. Os marcos abaixo refletem somente as atualizações registradas pela equipe.</p>
   <section className="delivery-card" aria-label="Marcos de implantação">
    <span className="delivery-pill">{project.status==='completed'?'Implantação concluída':project.status==='in_progress'?'Implantação em andamento':project.status==='paused'?'Implantação pausada':'Preparação do início'}</span>
    <h2>Andamento</h2>
    <p>As datas aparecem apenas quando confirmadas. Você pode retornar a esta página para consultar as atualizações.</p>
    <ol className="delivery-steps">{milestones.map(step=><li className={step.state} key={step.id}>
      <strong>{step.position.toString().padStart(2,'0')} · {step.title}</strong>
      <small>{stateLabel[step.state]}{step.completed_at?' · Concluído em '+date(step.completed_at):step.due_at?' · Previsão registrada: '+date(step.due_at):''}</small>
      {step.note&&<p>{step.note}</p>}
     </li>)}</ol>
    {project.completed_at&&<p role="status">A equipe registrou a conclusão em {date(project.completed_at)}.</p>}
   </section>
   <p className="delivery-footer">Precisa esclarecer uma etapa? <a href="https://wa.me/5521974510932" target="_blank" rel="noreferrer">Converse com a ORYNEO no WhatsApp</a>. Nunca compartilhe senhas, cartões ou códigos de acesso.</p>
  </main>
 </div>;
}
export function DeliveryPage(){
 const [record,setRecord]=useState<DeliveryRecord|null>(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const token=new URLSearchParams(window.location.search).get('token')||'';
 useEffect(()=>{
  if(!token){setError('O link de implantação está incompleto.');setLoading(false);return}
  let active=true;
  supabase.functions.invoke('delivery-public',{body:{token}}).then(({data,error:failed})=>{
   if(!active)return;
   if(failed||!data?.ok||!data?.project)setError('Não conseguimos abrir a implantação. Confirme o pagamento ou consulte a equipe ORYNEO.');
   else setRecord(data as DeliveryRecord);
  }).catch(()=>{if(active)setError('O serviço de implantação está temporariamente indisponível.')})
   .finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[token]);
 if(record)return <DeliveryView record={record}/>;
 return <div className="delivery-page"><main className="delivery-shell"><div className="delivery-state" role="status">
  {loading?'Carregando sua implantação…':<p className="delivery-error">{error}</p>}
 </div></main></div>;
}
