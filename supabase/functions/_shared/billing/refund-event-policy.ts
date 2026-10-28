const supported = new Set(['refund.created','refund.updated','refund.failed']);

export function classifyRefundEvent(eventType:string,source:Record<string,unknown>):'record'|'ignore'|'reject'{
  if(!supported.has(eventType))return 'ignore';
  if(source.object!=='refund'||!['pending','requires_action','succeeded','failed','canceled'].includes(String(source.status||'')))return 'reject';
  if(!Number.isSafeInteger(source.amount)||Number(source.amount)<=0||source.currency!=='brl')return 'reject';
  return 'record';
}
