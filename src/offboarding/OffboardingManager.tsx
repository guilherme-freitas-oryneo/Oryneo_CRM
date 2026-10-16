import {useCallback,useEffect,useState} from 'react';
import {supabase} from '../data';
import {billingErrorText} from '../billing/api';

type Request={id:string;request_type:string;state:string;requester_name:string;requester_email:string;details:string|null;created_at:string};
export function OffboardingManager({dealId}:{dealId:string}){
 const [orderId,setOrderId]=useState<string|null>(null);
 const [requests,setRequests]=useState<Request[]>([]);
 const [note,setNote]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async()=>{
  setError('');
  try{
   const {data:order,error:oError}=await supabase.from('crm_billing_orders')
    .select('id').eq('deal_id',dealId).in('status',['paid','canceled'])
    .order('created_at',{ascending:false}).limit(1).maybeSingle();
   if(oError)throw oError;
   setOrderId(order?.id||null);
   if(!order){setRequests([]);return}
   const {data,error:rError}=await supabase.from('crm_offboarding_requests')
    .select('id,request_type,state,requester_name,requester_email,details,created_at')
    .eq('order_id',order.id).order('created_at',{ascending:false});
   if(rError)throw rError;
   setRequests((data||[]) as Request[]);
  }catch(e){setError(await billingErrorText(e))}
 },[dealId]);
 useEffect(()=>{void load()},[load]);
 const review=async(req:Request,state:'in_review'|'fulfilled'|'rejected')=>{
  if(busy)return;setBusy(true);setError('');setNotice('');
  try{
   const {data,error:failure}=await supabase.functions.invoke('offboarding-admin',{body:{
    request_id:req.id,state,note:note[req.id]||''
   }});
   if(failure||!data?.ok)throw new Error(data?.error||'Não foi possível registrar a revisão.');
   setNotice('Revisão registrada. Nenhum arquivo foi enviado automaticamente.');
   await load();
  }catch(e){setError(await billingErrorText(e))}
  finally{setBusy(false)}
 };
 return <section className="billing-action">
  <small>F05 · PRIVACIDADE E ENCERRAMENTO</small>
  <h4>Solicitações vinculadas ao cliente</h4>
  <p>{!orderId?'Disponível quando existir contratação paga.':requests.length?'Analise identidade e escopo antes de qualquer exportação ou conclusão contratual.':'Nenhuma solicitação registrada.'}</p>
  {requests.map(req=><div key={req.id} style={{padding:14,border:'1px solid #e2e5eb',borderRadius:8,margin:'12px 0'}}>
   <strong>{req.request_type==='data_export'?'Exportação de dados':'Esclarecimento contratual'} · {req.state}</strong>
   <p>{req.requester_name} · {req.requester_email}<br/>{req.details||'Sem detalhes adicionais'}</p>
   <label>Registro interno da conferência de identidade e do escopo
    <textarea maxLength={2000} value={note[req.id]||''} onChange={e=>setNote(n=>({...n,[req.id]:e.target.value}))}/>
   </label>
   <button type="button" disabled={busy} onClick={()=>void review(req,'in_review')}>Em análise</button>
   <button type="button" disabled={busy||!(note[req.id]||'').trim()} onClick={()=>void review(req,'fulfilled')}>Concluído após verificação</button>
   <button type="button" disabled={busy||!(note[req.id]||'').trim()} onClick={()=>void review(req,'rejected')}>Recusar com justificativa</button>
  </div>)}
  {notice&&<p role="status">{notice}</p>}
  {error&&<p className="cd-error" role="alert">{error}</p>}
 </section>;
}
