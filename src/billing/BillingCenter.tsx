import { useEffect, useState } from 'react';
import { Barcode, CalendarClock, Check, Copy, CreditCard, QrCode, RefreshCw } from 'lucide-react';
import { supabase, errorText } from '../data';

type Order = {
  id: string; reference: string; status: string; billing_environment: 'test'|'live';
  selection: {plan?:string;cycle?:string;addons?:string[];payment_method?:string};
  items: Array<{key:string;label:string;detail:string;amount_cents:number}>;
  amount_total:number; customer_email:string; created_at:string; paid_at:string|null;
  stripe_subscription_id:string|null; traffic_next_charge_at:string|null;
  main_subscription_status:string|null; traffic_subscription_status:string|null;
  renewal_payment_status:string|null;
};
type Charge = {id:string;method:'pix_assisted'|'boleto_assisted';obligation_kind:string;competence_key:string;state:string;due_at:string;amount_total:number;url?:string|null;created_at:string};
type ContractDates={plan_next:string|null;plan_status:string|null;traffic_next:string|null;traffic_status:string|null};
const money=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
const date=(value?:string|null)=>value?new Date(value).toLocaleDateString('pt-BR'):'—';
const methodLabel=(method:string)=>method==='pix_assisted'?'Pix avulso':'Boleto';
const stateLabel=(state:string)=>({scheduled:'Agendada',open:'Aguardando pagamento',processing:'Em confirmação',paid:'Paga',expired:'Expirada',failed:'Falhou',overdue:'Em atraso',canceled:'Cancelada',requires_review:'Revisar'}[state]||state);

export function BillingCenter({dealId}:{dealId:string}){
 const [orders,setOrders]=useState<Order[]>([]),[charges,setCharges]=useState<Charge[]>([]),[contractDates,setContractDates]=useState<ContractDates|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false),[service,setService]=useState<'plan'|'traffic'>('plan'),[method,setMethod]=useState<'pix_assisted'|'boleto_assisted'>('pix_assisted'),[dueAt,setDueAt]=useState('');
 const [copyId,setCopyId]=useState('');
 const order=orders.find(item=>item.status==='paid')||orders[0]||null;
 const traffic=order?.selection.addons?.includes('traffic')||order?.items.some(item=>item.key==='traffic')||false;
 const refresh=async()=>{
  setLoading(true);setError('');setCharges([]);setContractDates(null);
  try{
   const {data,error:ordersError}=await supabase.from('crm_billing_orders').select('id,reference,status,billing_environment,selection,items,amount_total,customer_email,created_at,paid_at,stripe_subscription_id,traffic_next_charge_at,main_subscription_status,traffic_subscription_status,renewal_payment_status').eq('deal_id',dealId).order('created_at',{ascending:false}).limit(10);
   if(ordersError)throw ordersError;
   const list=(data||[]) as Order[];setOrders(list);const active=list.find(item=>item.status==='paid')||list[0];
   if(active){
    const {data:response,error:invokeError}=await supabase.functions.invoke('billing-center',{body:{action:'list',order_id:active.id}});
    if(invokeError)throw new Error(await errorText(invokeError));
    setCharges(Array.isArray(response?.charges)?response.charges:[]);setContractDates(response?.contract_dates||null);
    const suggestedDate=(response?.contract_dates?.plan_next||active.paid_at||'').slice(0,10);if(suggestedDate)setDueAt(current=>current||suggestedDate);
   }else{setCharges([]);setContractDates(null)}
  }catch(e){setError(errorText(e))}finally{setLoading(false)}
 };
 useEffect(()=>{void refresh()},[dealId]);
 const prepare=async()=>{
  if(!order||!dueAt||busy)return;
  setBusy(true);setError('');setNotice('');
  try{
   const {data,error:invokeError}=await supabase.functions.invoke('billing-center',{body:{action:'prepare_and_email',order_id:order.id,service,method,due_at:new Date(`${dueAt}T12:00:00`).toISOString()}});
   if(invokeError)throw new Error(await errorText(invokeError));
   if(!data?.ok)throw new Error(data?.error||'Não foi possível preparar a cobrança.');
   setNotice(data.email_sent?'Cobrança criada e e-mail enviado.':'Cobrança criada. O envio do e-mail precisa de revisão.');
   await refresh();
  }catch(e){setError(errorText(e))}finally{setBusy(false)}
 };
 const copy=async(charge:Charge)=>{if(!charge.url)return;await navigator.clipboard.writeText(charge.url);setCopyId(charge.id);setTimeout(()=>setCopyId(''),1800)};
 return <div className="billing-center">
  <div className="billing-center-heading"><div><small>CONTRATO E COBRANÇAS</small><h3><CreditCard size={17}/>Central de cobranças</h3><p>Plano, datas de renovação e cobranças individuais registradas para este cliente.</p></div><button type="button" className="billing-refresh" onClick={()=>void refresh()} aria-label="Atualizar cobranças"><RefreshCw size={15}/></button></div>
  {error&&<p className="cd-error" role="alert">{error}</p>}{notice&&<p className="cd-success" role="status">{notice}</p>}
  {loading?<p className="cd-muted">Carregando dados financeiros…</p>:!order?<p className="cd-muted">Ainda não há pedido de cobrança nesta ficha.</p>:<>
   <div className="billing-contract-grid">
    <div><small>PLANO</small><strong>{order.selection.plan||'—'} · {order.selection.cycle==='annual'?'Anual':'Mensal'}</strong></div>
    <div><small>INÍCIO DO CONTRATO</small><strong>{date(order.paid_at)}</strong></div>
    <div><small>PRÓXIMA COBRANÇA DO PLANO</small><strong>{date(contractDates?.plan_next)}</strong><span>{contractDates?.plan_status||order.main_subscription_status||order.renewal_payment_status||'Status não informado'}</span></div>
    <div><small>MEIO ORIGINAL</small><strong>{order.selection.payment_method==='pix'?'Pix':order.selection.payment_method==='boleto'?'Boleto':'Cartão'}</strong><span>{order.billing_environment==='test'?'Homologação':'Produção'}</span></div>
   </div>
   {traffic&&<div className="billing-traffic"><strong>Tráfego pago · período inicial de 3 meses</strong><span>Período inicial: {date(order.paid_at)} a {date(contractDates?.traffic_next||order.traffic_next_charge_at)}</span><span>Próxima cobrança trimestral: {date(contractDates?.traffic_next||order.traffic_next_charge_at)}</span><span>Status: {contractDates?.traffic_status||order.traffic_subscription_status||'período inicial / status não informado'}</span></div>}
   <section className="billing-issue"><h4>Preparar cobrança avulsa</h4><p>O valor é calculado a partir do plano e dos serviços deste pedido. Pix não renova sozinho; cada competência exige uma nova cobrança.</p>
    <div className="billing-issue-fields"><label>O que vence<select value={service} onChange={e=>{const value=e.target.value as 'plan'|'traffic';setService(value);const suggested=(value==='traffic'?contractDates?.traffic_next:contractDates?.plan_next)||'';if(suggested)setDueAt(suggested.slice(0,10))}}><option value="plan">Plano</option>{traffic&&<option value="traffic">Gestão de tráfego pago</option>}</select></label><label>Forma de pagamento<select value={method} onChange={e=>setMethod(e.target.value as 'pix_assisted'|'boleto_assisted')}><option value="pix_assisted">Pix avulso</option><option value="boleto_assisted">Boleto</option></select></label><label>Data de cobrança<input type="date" value={dueAt} onChange={e=>setDueAt(e.target.value)}/></label></div>
    <button className="cd-primary" type="button" disabled={!dueAt||busy||order.status!=='paid'} onClick={()=>void prepare()}>{busy?'Preparando…':'Gerar link e enviar por e-mail'}</button>
    {order.status!=='paid'&&<small>A cobrança de renovação fica disponível depois que o pedido inicial estiver pago.</small>}
   </section>
   <section className="billing-charge-list"><h4>Histórico de cobranças avulsas</h4>{!charges.length?<p className="cd-muted">Nenhuma cobrança avulsa registrada.</p>:charges.map(charge=><article key={charge.id}><div className="billing-charge-icon">{charge.method==='pix_assisted'?<QrCode size={17}/>:<Barcode size={17}/>}</div><div className="billing-charge-copy"><strong>{methodLabel(charge.method)} · {charge.obligation_kind==='traffic_quarterly'?'Tráfego':'Plano'}</strong><span>Competência {charge.competence_key} · vence {date(charge.due_at)}</span><small>{stateLabel(charge.state)} · {money(charge.amount_total)}</small></div>{charge.url&&<button type="button" onClick={()=>void copy(charge)}>{copyId===charge.id?<Check size={15}/>:<Copy size={15}/>} {copyId===charge.id?'Copiado':'Copiar link'}</button>}</article>)}</section>
  </>}
 </div>;
}
