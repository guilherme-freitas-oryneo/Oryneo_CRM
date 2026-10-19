import {useCallback,useEffect,useState} from 'react';
import {Check,Copy,ExternalLink,FileCheck2,RefreshCw} from 'lucide-react';
import {supabase} from '../data';
import {billingErrorText} from './api';
import {BillingAction, type PreparedBilling} from './BillingAction';

type ProposalStatus = 'sent' | 'accepted' | 'superseded' | 'expired';
type ProposalLink = {version:number;url:string};

const proposalSessionKey=(dealId:string)=>'oryneo.crm.proposal-link.'+dealId;
function safeProposalLink(value:unknown):value is ProposalLink {
 if(!value||typeof value!=='object')return false;
 const candidate=value as Partial<ProposalLink>;
 if(!Number.isSafeInteger(candidate.version)||Number(candidate.version)<1||typeof candidate.url!=='string')return false;
 try{
  const url=new URL(candidate.url);
  return url.protocol==='https:'&&url.hostname==='guilherme-freitas-oryneo.github.io'&&
    url.pathname==='/Oryneo_CRM/proposta/'&&
    /^[A-Za-z0-9_-]{42,50}$/.test(url.searchParams.get('token')||'');
 }catch{return false}
}
function readSessionProposalLink(dealId:string):ProposalLink|null {
 try{
  const value=window.sessionStorage.getItem(proposalSessionKey(dealId));
  if(!value)return null;
  const parsed:unknown=JSON.parse(value);
  return safeProposalLink(parsed)?parsed:null;
 }catch{return null}
}
function storeSessionProposalLink(dealId:string,link:ProposalLink|null){
 try{if(link)window.sessionStorage.setItem(proposalSessionKey(dealId),JSON.stringify(link));
 else window.sessionStorage.removeItem(proposalSessionKey(dealId));}catch{/* Browser storage is optional. */}
}


export function ProposalAction({dealId,canPrepare,onPrepareBilling}:{
 dealId:string;canPrepare:boolean;onPrepareBilling:()=>Promise<PreparedBilling>
}){
 const [status,setStatus]=useState<ProposalStatus|null>(null);
 const [version,setVersion]=useState<number|null>(null);
 const [loading,setLoading]=useState(false);
 const [issuing,setIssuing]=useState(false);
 const [link,setLink]=useState<ProposalLink|null>(()=>readSessionProposalLink(dealId));
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
   const stored=readSessionProposalLink(dealId);
   if(stored&&stored.version===data?.version&&(effective==='sent'||effective==='accepted'))setLink(stored);
   else{setLink(null);storeSessionProposalLink(dealId,null)}
  }catch(e){setError(await billingErrorText(e))}
  finally{setLoading(false)}
 },[dealId]);
 useEffect(()=>{setLink(readSessionProposalLink(dealId));void refresh()},[dealId,refresh]);
 const issue=async()=>{
  if(issuing)return;
  setIssuing(true);setError('');setCopied(false);
  try{
   const {data,error:invokeError}=await supabase.functions.invoke('proposal-create',{body:{deal_id:dealId}});
   if(invokeError)throw invokeError;
   if(!data?.ok||!data?.url)throw new Error(data?.error||'Não foi possível preparar a proposta.');
   const issued:ProposalLink={version:data.version,url:data.url};
   if(!safeProposalLink(issued))throw new Error('A proposta foi emitida, mas o endereço retornado é inválido. Não reemita antes de conferir o registro.');
   storeSessionProposalLink(dealId,issued);
   setLink(issued);setStatus('sent');setVersion(data.version);
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
    <a className="billing-open-link" href={link.url} target="_blank" rel="noopener noreferrer" aria-label="Abrir proposta em nova aba"><ExternalLink size={15}/>Abrir proposta</a>
    <button type="button" onClick={()=>void copy()}>{copied?<Check size={15}/>:<Copy size={15}/>}
     {copied?'Copiado':'Copiar link'}
    </button></div>
  </div>}
  {status==='sent'&&!link&&<p role="note">Esta versão já foi emitida em outra sessão. Por segurança, recupere o link enviado ao destinatário antes de gerar uma nova versão.</p>}
  {status==='accepted'
   ? <BillingAction canPrepare={canPrepare} onPrepare={onPrepareBilling}/>
   : <p>O link de pagamento será liberado somente após o aceite desta versão.</p>}
  {error&&<p className="cd-error" role="alert">{error}</p>}
 </div>;
}
