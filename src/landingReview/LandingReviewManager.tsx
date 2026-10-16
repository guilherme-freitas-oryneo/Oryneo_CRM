import {useCallback,useEffect,useState} from 'react';
import {Check,Copy,ExternalLink,RefreshCw,Send} from 'lucide-react';
import {supabase} from '../data';
import {billingErrorText} from '../billing/api';

type Review={version:number;status:string;preview_url:string;published_url:string|null;preview_html_sha256:string};
export function LandingReviewManager({dealId}:{dealId:string}){
 const [orderId,setOrderId]=useState<string|null>(null);
 const [included,setIncluded]=useState(false);
 const [review,setReview]=useState<Review|null>(null);
 const [url,setUrl]=useState('');
 const [publishedUrl,setPublishedUrl]=useState('');
 const [reviewLink,setReviewLink]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [copied,setCopied]=useState(false);
 const refresh=useCallback(async()=>{
  setError('');
  try{
   const {data:order,error:orderError}=await supabase.from('crm_billing_orders')
    .select('id,status,selection').eq('deal_id',dealId).eq('status','paid').order('created_at',{ascending:false}).limit(1).maybeSingle();
   if(orderError)throw orderError;
   const addons=(order?.selection as {addons?:string[]}|undefined)?.addons||[];
   const eligible=order?.status==='paid'&&addons.includes('landing-page');
   setIncluded(eligible);setOrderId(eligible?order.id:null);
   if(!eligible){setReview(null);return}
   const {data:latest,error:reviewError}=await supabase.from('crm_landing_reviews')
    .select('version,status,preview_url,published_url,preview_html_sha256')
    .eq('order_id',order.id).order('version',{ascending:false}).limit(1).maybeSingle();
   if(reviewError)throw reviewError;
   setReview(latest as Review|null);
   if(latest?.preview_url)setUrl(latest.preview_url);
  }catch(e){setError(await billingErrorText(e))}
 },[dealId]);
 useEffect(()=>{void refresh()},[refresh]);
 const run=async(action:'issue'|'publish')=>{
  if(!orderId||busy)return;setBusy(true);setError('');setNotice('');
  try{
   const {data,error:requestError}=await supabase.functions.invoke('landing-admin',{body:{
    action,order_id:orderId,version:review?.version,
    url:action==='issue'?url.trim():publishedUrl.trim()
   }});
   if(requestError)throw requestError;
   if(!data?.ok)throw new Error(data?.error||'Não foi possível concluir esta operação.');
   if(action==='issue'){setReviewLink(data.url);setCopied(false);
    setNotice('Nova versão emitida. A versão anterior não poderá receber novo aceite.')}
   else setNotice('Publicação verificada e registrada para esta versão.');
   await refresh();
  }catch(e){setError(await billingErrorText(e))}
  finally{setBusy(false)}
 };
 if(!included)return <div className="billing-action"><small>F04 · LANDING PAGE</small>
  <p>A revisão fica disponível somente após a confirmação do pagamento de uma landing page contratada.</p>
  {error&&<p role="alert" className="cd-error">{error}</p>}</div>;
 return <div className="billing-action">
  <small>F04 · REVISÃO E PUBLICAÇÃO DE LANDING PAGE</small>
  <h4>Aprovação de versão pelo cliente</h4>
  <p>{review?`Versão ${review.version} · ${review.status}`:'Nenhuma versão de prévia foi emitida.'}</p>
  <label>URL da prévia HTML publicada no GitHub Pages oficial
   <input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/..."/>
  </label>
  <button type="button" disabled={busy||!url.trim()} onClick={()=>void run('issue')}>
   <Send size={15}/>{busy?'Verificando…':'Emitir revisão de versão'}
  </button>
  {reviewLink&&<div className="billing-link"><span>Envie somente ao destinatário autorizado</span>
   <div><input aria-label="Link individual de revisão" readOnly value={reviewLink}/>
    <button type="button" onClick={()=>void navigator.clipboard.writeText(reviewLink).then(()=>setCopied(true)).catch(()=>setError('Não foi possível copiar o link.'))}>
     {copied?<Check size={15}/>:<Copy size={15}/>} {copied?'Copiado':'Copiar'}
    </button></div></div>}
  {review?.status==='approved'&&<div>
   <p><strong>Versão aprovada.</strong> Informe a URL final. O sistema só registrará a publicação se o arquivo HTML corresponder à versão aprovada.</p>
   <input type="url" aria-label="URL final da landing page" value={publishedUrl} onChange={e=>setPublishedUrl(e.target.value)} placeholder="https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/..."/>
   <button type="button" disabled={busy||!publishedUrl.trim()} onClick={()=>void run('publish')}><ExternalLink size={15}/>Validar e registrar publicação</button>
  </div>}
  {review?.status==='published'&&review.published_url&&<p><a href={review.published_url} target="_blank" rel="noreferrer">Abrir landing page publicada</a></p>}
  <button type="button" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={15}/>Atualizar status</button>
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" className="cd-error">{error}</p>}
 </div>;
}
