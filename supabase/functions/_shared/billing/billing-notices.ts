export type BillingNoticeKind='boleto_issued'|'payment_failed'|'payment_confirmed';
export type BillingNoticeInput=Readonly<{
 kind:BillingNoticeKind;customerName:string;reference:string;amountCents:number;
 invoiceUrl?:string|null;
}>;
const money=(cents:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function trustedInvoiceUrl(raw:string|null|undefined):string|null{
 if(!raw)return null;
 const url=new URL(raw);
 if(url.protocol!=='https:'||!['invoice.stripe.com','pay.stripe.com'].includes(url.hostname))throw Error('UNTRUSTED_INVOICE_LINK');
 return url.toString();
}
/** Transactional content only. Sending requires an audited outbox with retries and consent policy. */
export function billingNotice(input:BillingNoticeInput):{subject:string;text:string;html:string}{
 if(!Number.isSafeInteger(input.amountCents)||input.amountCents<=0||!input.reference)throw Error('INVALID_BILLING_NOTICE');
 const link=trustedInvoiceUrl(input.invoiceUrl);
 const name=input.customerName.trim().split(/\s+/)[0]||'cliente';
 const title=input.kind==='boleto_issued'?'Seu boleto ORYNEO está disponível':input.kind==='payment_failed'?'Precisamos revisar seu pagamento ORYNEO':'Pagamento ORYNEO confirmado';
 const explanation=input.kind==='boleto_issued'?'O boleto foi emitido, mas ainda não consta como pago. O acesso depende da confirmação bancária.':
  input.kind==='payment_failed'?'O pagamento não foi confirmado. A cobrança permanece pendente e a equipe poderá orientar uma nova tentativa.':
  'O pagamento foi confirmado pelo sistema financeiro. Nossa equipe seguirá com os próximos passos.';
 const text=`Olá, ${name}.\n\n${explanation}\nPedido: ${input.reference}\nValor: ${money(input.amountCents)}\n${link?'Fatura segura: '+link+'\n':''}\nEquipe ORYNEO`;
 const html=`<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f7f8fb;font-family:Arial,Helvetica,sans-serif;color:#202632"><main style="max-width:560px;margin:32px auto;background:#fff;padding:32px"><p style="color:#5269ff;letter-spacing:2px;font-size:12px">ORYNEO · FINANCEIRO</p><h1 style="font-size:24px">${escape(title)}</h1><p>Olá, ${escape(name)}.</p><p>${escape(explanation)}</p><p>Pedido: <strong>${escape(input.reference)}</strong></p><p>Valor: <strong>${escape(money(input.amountCents))}</strong></p>${link?'<p><a href="'+escape(link)+'" style="display:inline-block;padding:13px 20px;background:#5269ff;color:#fff;text-decoration:none;border-radius:8px">Consultar fatura segura</a></p>':''}<p style="color:#7b8290;font-size:12px">Nunca solicitamos senhas ou dados completos de cartão por e-mail.</p></main></body></html>`;
 return {subject:title,text,html};
}
