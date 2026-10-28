import { useState } from 'react';
import { Check, Copy, CreditCard, ExternalLink, LoaderCircle } from 'lucide-react';

export type PreparedBilling={reference:string;url:string};
export function BillingAction({canPrepare,onPrepare}:{canPrepare:boolean;onPrepare:()=>Promise<PreparedBilling>}){
 const [busy,setBusy]=useState(false),[result,setResult]=useState<PreparedBilling|null>(null),[error,setError]=useState(''),[copied,setCopied]=useState(false);
 const prepare=async()=>{if(busy)return;setBusy(true);setError('');try{setResult(await onPrepare())}catch(e){setError(e instanceof Error?e.message:'Não foi possível preparar a cobrança.')}finally{setBusy(false)}};
 const copy=async()=>{if(!result)return;await navigator.clipboard.writeText(result.url);setCopied(true)};
 return <div className="billing-action">
  <div><small>LINK DE PAGAMENTO · AMBIENTE DEFINIDO PELO SERVIDOR</small><h4><CreditCard size={16}/>Pagamento ORYNEO</h4><p>Gere o link somente após confirmar escopo, valores e condições com o cliente.</p></div>
  {!result?<button className="cd-primary" disabled={!canPrepare||busy} onClick={()=>void prepare()}>{busy?<LoaderCircle className="spinner" size={16}/>:<CreditCard size={16}/>}Preparar cobrança</button>:<div className="billing-link"><span>Pedido <strong>{result.reference}</strong></span><div><input aria-label="Link de pagamento" readOnly value={result.url}/><a className="billing-open-link" href={result.url} target="_blank" rel="noopener noreferrer" aria-label="Abrir checkout em nova aba"><ExternalLink size={15}/>Abrir checkout</a><button type="button" onClick={()=>void copy()}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?'Copiado':'Copiar link'}</button></div></div>}
  {error&&<p className="cd-error" role="alert">{error}</p>}
 </div>;
}
