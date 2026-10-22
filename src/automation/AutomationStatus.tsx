import { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Clock3, Mail, RefreshCw, ShieldAlert } from 'lucide-react';
import { supabase } from '../data';
import './automation-status.css';

type JobType =
  | 'lead_received_email'
  | 'implementation_started_email'
  | 'payment_link_email'
  | 'payment_reminder_email'
  | 'payment_confirmed_email'
  | 'renewal_failed_email'
  | 'pix_due_email'
  | 'assisted_payment_reminder_email'
  | 'financial_review_required';
type JobState = 'scheduled' | 'running' | 'sent' | 'failed' | 'reconciliation' | 'suppressed' | 'cancelled' | 'dead';
export type AutomationJob = {
  id: string;
  job_type: JobType;
  state: JobState;
  due_at: string;
  attempts: number;
  completed_at: string | null;
  created_at: string;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Horário indisponível' : date.toLocaleString('pt-BR', {dateStyle:'short',timeStyle:'short'});
};
export function remainingTime(dueAt:string, now:number):string {
  const timestamp=Date.parse(dueAt);
  if(!Number.isFinite(timestamp))return 'Prazo indisponível';
  const seconds=Math.max(0,Math.ceil((timestamp-now)/1000));
  if(seconds===0)return 'Aguardando processamento';
  const min=Math.floor(seconds/60),sec=seconds%60;
  return `${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
export function automationLabel(job: Pick<AutomationJob,'state'|'due_at'|'completed_at'>, now:number) {
  switch(job.state) {
    case 'scheduled': return Date.parse(job.due_at)>now ? `Envio automático em ${remainingTime(job.due_at,now)}` : 'Aguardando processamento automático';
    case 'running': return 'Envio em processamento';
    case 'sent': return job.completed_at ? `Enviado em ${formatDate(job.completed_at)}` : 'Enviado';
    case 'failed': return Date.parse(job.due_at)>now ? `Nova tentativa em ${remainingTime(job.due_at,now)}` : 'Aguardando nova tentativa';
    case 'reconciliation': return 'Aguardando conciliação do envio';
    case 'suppressed': return 'Envio impedido — verificar dados do destinatário';
    case 'cancelled': return 'Envio cancelado';
    case 'dead': return 'Tentativas encerradas — requer revisão';
  }
}

const titles: Record<JobType,string> = {
  lead_received_email:'Confirmação de solicitação',
  implementation_started_email:'Início da implantação',
  payment_link_email:'Cobrança pronta para envio',
  payment_reminder_email:'Lembrete de pagamento',
  payment_confirmed_email:'Pagamento confirmado',
  renewal_failed_email:'Falha na renovação',
  pix_due_email:'Cobrança Pix disponível',
  assisted_payment_reminder_email:'Lembrete de pagamento',
  financial_review_required:'Revisão financeira necessária',
};

export function automationTitle(jobType: JobType): string {
  return titles[jobType] || 'Comunicação ORYNEO';
}

export function AutomationStatus({ dealId }: { dealId:string }) {
  const [jobs,setJobs] = useState<AutomationJob[]>([]);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState(false);
  const [now,setNow] = useState(()=>Date.now());
  useEffect(()=>{
    let mounted=true;
    const load=async()=>{
      const result=await supabase.from('crm_automation_jobs')
        .select('id,job_type,state,due_at,attempts,completed_at,created_at')
        .eq('deal_id',dealId).order('created_at',{ascending:true});
      if(!mounted)return;
      if(result.error){setError(true)}else{
        setJobs((result.data||[]) as AutomationJob[]);
        setError(false);
      }
      setLoading(false);
    };
    void load();
    const channel=supabase.channel('oryneo-auto-'+dealId)
      .on('postgres_changes',{
        event:'*',schema:'public',table:'crm_automation_jobs',filter:'deal_id=eq.'+dealId
      },()=>{void load()})
      .subscribe();
    // Realtime is primary; periodic refresh reconciles temporary disconnections.
    const poll=setInterval(()=>{void load()},30000);
    const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>{mounted=false;clearInterval(timer);clearInterval(poll);void supabase.removeChannel(channel)};
  },[dealId]);

  return <section className="oryneo-automation" aria-label="Automações da oportunidade">
    <h3 className="cd-section-title"><CalendarClock size={17}/>Comunicações automáticas</h3>
    <p className="oryneo-automation-intro">Status do sistema e horário previsto. Não é necessário clicar para disparar os envios.</p>
    {loading?<p className="oryneo-automation-placeholder" role="status">Consultando automações…</p>
     :error?<p className="oryneo-automation-placeholder" role="status"><ShieldAlert size={15}/>Não foi possível atualizar o acompanhamento. O envio continua sendo gerenciado pelo servidor.</p>
     :jobs.length===0?<p className="oryneo-automation-placeholder">Não há comunicação automática agendada para esta oportunidade.</p>
     :<div className="oryneo-automation-list">{jobs.map(job=>
       <article key={job.id} className="oryneo-automation-item">
         <div className={'oryneo-automation-icon '+(job.state==='sent'?'is-sent':'')}>
           {job.state==='sent'?<CheckCircle2 size={17}/>:job.state==='failed'||job.state==='dead'||job.state==='reconciliation'?<RefreshCw size={17}/>:job.state==='scheduled'?<Clock3 size={17}/>:<Mail size={17}/>}
         </div>
         <div className="oryneo-automation-copy">
           <strong>{automationTitle(job.job_type)}</strong>
           <span aria-live="off">{automationLabel(job,now)}</span>
           <small>Previsão: {formatDate(job.due_at)}{job.attempts>0?' · Tentativa '+job.attempts:''}</small>
         </div>
       </article>
     )}</div>}
  </section>;
}
