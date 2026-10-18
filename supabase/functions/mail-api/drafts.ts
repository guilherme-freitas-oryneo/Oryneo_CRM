/** Validate untrusted draft attachments before retaining bytes in the database. */
export function validateDraftBody(body: Record<string,unknown>): void {
  const attachments=body.attachmentManifest??[];
  if(!Array.isArray(attachments)||attachments.length>100)throw new Error('INVALID_ATTACHMENT');
  let total=0;
  for(const entry of attachments){
    if(!entry||typeof entry!=='object')throw new Error('INVALID_ATTACHMENT');
    const a=entry as Record<string,unknown>;
    if(typeof a.filename!=='string'||!a.filename||a.filename.length>255||/[\r\n]/.test(a.filename)||typeof a.mimeType!=='string'||/[\r\n]/.test(a.mimeType)||typeof a.contentBase64!=='string'||(a.contentBase64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.contentBase64)))throw new Error('INVALID_ATTACHMENT');
    const size=a.contentBase64.length*3/4-(a.contentBase64.endsWith('==')?2:a.contentBase64.endsWith('=')?1:0);
    if(size>15*1024*1024)throw new Error('ATTACHMENT_TOO_LARGE');total+=size;
  }
  if(total>18*1024*1024)throw new Error('ATTACHMENTS_TOO_LARGE');
  const meta=body.composeMeta;
  if(meta!==undefined&&(!meta||typeof meta!=='object'||Array.isArray(meta)||JSON.stringify(meta).length>10000))throw new Error('INVALID_MESSAGE');
}

/** A lost save response may be retried; only the author's identical active revision is a success. */
export function sameSavedDraft(existing: Record<string,unknown>, values: Record<string,unknown>, revision: number): boolean {
  if(existing.state!=='active'||Number(existing.revision)!==revision)return false;
  const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
  return Object.entries(values).every(([key,value])=>canonical(existing[key])===canonical(value));
}
