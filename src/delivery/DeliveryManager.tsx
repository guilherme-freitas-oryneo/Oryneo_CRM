import {useCallback,useEffect,useState} from 'react';
import {RefreshCw,Save} from 'lucide-react';
import {supabase} from '../data';
import {billingErrorText} from '../billing/api';
import type {DeliveryMilestone} from './DeliveryPage';

type Project={status:string;started_at:string|null;completed_at:string|null};
export function DeliveryManager({dealId}:{dealId:string}){
 const [orderId,setOrderId]=useState<string|null>(null);
 const [project,setProject]=useState<Project|null>(null);
 const [milestones,setMilestones]=useState<DeliveryMilestone[]>([]);
 const [pendingId,setPendingId]=useState<string|null>(null);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const load=useCallback(async()=>{
  setError('');
  try{
   const {data:order,error:billingError}=await supabase.from('crm_billing_orders').select('id,status')
    .eq('deal_id',dealId).eq('status','paid').order('created_at',{ascending:false}).limit(1).maybeSingle();
   if(billingError)throw billingError;
   if(!order||order.status!=='paid'){setOrderId(null);setProject(null);setMilestones([]);return}
   setOrderId(order.id);
   const [a,b]=await Promise.all([
    supabase.from('crm_delivery_projects').select('status,started_at,completed_at').eq('order_id',order.id).maybeSingle(),
    supabase.from('crm_delivery_milestones').select('id,position,title,state,due_at,note,completed_at,updated_at')
      .eq('order_id',order.id).order('position')
   ]);
   if(a.error)throw a.error;if(b.error)throw b.error;
   setProject(a.data as Project|null);
   setMilestones((b.data||[]) as DeliveryMilestone[]);
  }catch(e){setError(await billingErrorText(e))}
 },[dealId]);
 useEffect(()=>{void load()},[load]);
 const update=async(item:DeliveryMilestone)=>{
  if(!orderId||busy)return;setPendingId(item.id);setBusy(true);setError('');setNotice('');
  try{
   const {data,error:invokeError}=await supabase.functions.invoke('delivery-admin',{body:{
    order_id:orderId,milestone_id:item.id,state:item.state,due_at:item.due_at,note:item.note
   }});
   if(invokeError)throw invokeError;
   if(!data?.ok)throw new Error(data?.error||'Não foi possível atualizar o marco.');
   await load();setNotice('Marco registrado com sucesso.');
  }catch(e){setError(await billingErrorText(e))}
  finally{setBusy(false);setPendingId(null)}
 };
 if(!orderId)return <div className="billing-action"><small>F03 · IMPLANTAÇÃO</small><p>O acompanhamento começará após a confirmação do pagamento.</p>{error&&<p className="cd-error" role="alert">{error}</p>}</div>;
 return <div className="billing-action">
  <div><small>F03 · IMPLANTAÇÃO DO CLIENTE</small><h4>Marcos da entrega</h4>
   <p>Estado atual: {project?.status||'Aguardando registro'}. Altere apenas após confirmar o trabalho realizado; nenhuma previsão será inventada.</p>
  </div>
  {milestones.map((step,i)=><div key={step.id} style={{padding:16,border:'1px solid #e2e7ef',borderRadius:9,marginBottom:10}}>
   <strong>{step.position}. {step.title}</strong>
   <label style={{display:'block',marginTop:8}}>Andamento
    <select aria-label={'Andamento de '+step.title} disabled={busy} value={step.state}
     onChange={e=>setMilestones(s=>s.map((v,j)=>j===i?{...v,state:e.target.value as DeliveryMilestone['state']}:v))}>
     <option value="pending">Pendente</option><option value="in_progress">Em andamento</option>
     <option value="blocked">Aguardando informações</option><option value="completed">Concluído</option>
    </select></label>
   <label style={{display:'block',marginTop:8}}>Previsão (somente quando confirmada)
    <input aria-label={'Previsão de '+step.title} type="date" disabled={busy} value={step.due_at?.slice(0,10)||''}
     onChange={e=>setMilestones(s=>s.map((v,j)=>j===i?{...v,due_at:e.target.value?e.target.value+'T12:00:00Z':null}:v))}/></label>
   <label style={{display:'block',marginTop:8}}>Observação pública para o cliente
    <textarea aria-label={'Observação de '+step.title} maxLength={1000} disabled={busy}
     value={step.note||''} onChange={e=>setMilestones(s=>s.map((v,j)=>j===i?{...v,note:e.target.value}:v))}/>
   </label>
   <button type="button" disabled={busy} onClick={()=>void update(step)}>
    <Save size={14}/>{pendingId===step.id?'Salvando…':'Salvar marco'}
   </button>
  </div>)}
  <button type="button" disabled={busy} onClick={()=>void load()}><RefreshCw size={15}/>Atualizar do banco</button>
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" className="cd-error">{error}</p>}
 </div>;
}
