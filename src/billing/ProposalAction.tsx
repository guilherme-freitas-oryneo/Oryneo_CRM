import {useCallback,useEffect,useState} from 'react';
import {Check,Copy,FileCheck2,RefreshCw} from 'lucide-react';
import {supabase} from '../data';
import {billingErrorText} from './api';
import {BillingAction, type PreparedBilling} from './BillingAction';

type ProposalStatus = 'sent' | 'accepted' | 'superseded' | 'expired';
type ProposalLink = {version:number;url:string};

export function ProposalAction({dealId,canPrepare,onPrepareBilling}:{
 dealId:string;canPrepare:boolean;onPrepareBilling:()=>Promise<PreparedBilling>
}){
 const [status,setStatus]=useState<ProposalStatus|null>(null);
 const [version,setVersion]=useState<number|null>(null);
 const [loading,setLoading]=useState(false);
 const [issuing,setIssuing]=useState(false);
 const [link,setLink]=useState<ProposalLink|null>(null);
 const [copied,setCopied]=useState(false);
 const [error,setError]=useState('');
 const refresh=useCallback(async()=>{
  setLoading(true);setError('');
  try{
   const {data,error:lookupError}=await supabase.from('crm_proposals')
    .select('status,version,expires_at').eq('deal_id',dealId)
    .order('version',{ascending:false}).limit(1).maybeSingle();
   if(lookupError)throw lookupError;
   const effective:ProposalStatus|null=data?.status==='sent'&&new Date(data.expires_at).getTime()<=Date.now()
    ? 'expired':(data?.status as ProposalStatus|undefined)??null;
   setStatus(effective);setVersion(data?.version??null);
  }catch(e){setError(await billingErrorText(e))}
  finally{setLoading(false)}
 },[dealId]);
 useEffect(()=>{void refresh()},[refresh]);
 const issue=async()=>{
  if(issuing)return;
  setIssuing(true);setError('');setCopied(false);
  try{
   const {data,error:invokeError}=await supabase.functions.invoke('proposal-create',{body:{deal_id:dealId}});
   if(invokeError)throw invokeError;
   if(!data?.ok||!data?.url)throw new Error(data?.error||'Não foi possível preparar a proposta.');
   setLink({version:data.version,url:data.url});setStatus('sent');setVersion(data.version);
  }catch(e){setError(await billingErrorText(e))}
  finally{setIssuing(false)}
 };
 const copy=async()=>{if(!link)return;try{await navigator.clipboard.writeText(link.url);setCopied(true)}
  catch{setError('O navegador bloqueou a cópia. Copie o link diretamente do campo.')}};
 return <div className="billing-action">
  <div>
   <small>F01 · PROPOSTA COMERCIAL VERSIONADA</small>
   <h4><FileCheck2 size={16}/>Aceite de condições</h4>
   <p>O cliente deve revisar o valor inicial, a recorrência e os complementos antes de receber o link de pagamento. Cada nova versão invalida o link anterior.</p>
   <p role="status">{loading?'Conferindo aceite…':status==='accepted'
    ?`Versão ${version} aceita pelo cliente.`
    :status==='sent'?`Versão ${version} aguardando aceite do cliente.`
    :status?'A proposta anterior não está mais válida.':'Ainda não existe proposta individual enviada.'}</p>
  </div>
  <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   <button className="cd-primary" type="button" disabled={issuing||!canPrepare} onClick={()=>void issue()}>
    <FileCheck2 size={16}/>{issuing?'Preparando…':status?'Emitir nova versão':'Gerar proposta individual'}
   </button>
   <button type="button" disabled={loading} onClick={()=>void refresh()}><RefreshCw size={15}/>Atualizar aceite</button>
  </div>
  {link&&<div className="billing-link">
   <span>Proposta <strong>versão {link.version}</strong> · encaminhe somente ao destinatário autorizado</span>
   <div><input aria-label="Link seguro da proposta" readOnly value={link.url}/>
    <button type="button" onClick={()=>void copy()}>{copied?<Check size={15}/>:<Copy size={15}/>}
     {copied?'Copiado':'Copiar link'}
    </button></div>
  </div>}
  {status==='accepted'
   ? <BillingAction canPrepare={canPrepare} onPrepare={onPrepareBilling}/>
   : <p>O link de pagamento será liberado somente após o aceite desta versão.</p>}
  {error&&<p className="cd-error" role="alert">{error}</p>}
 </div>;
}
