import type { MailAddress } from './types';
export type AttachmentPayload = { filename: string; mimeType: string; contentBase64: string };
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_ATTACHMENTS_BYTES = 18 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
export function parseAddresses(value: string, strict = true): MailAddress[] {
  return value.split(/[;,]/).map(item => item.trim()).filter(Boolean).map(item => {
    const named = item.match(/^(.+?)\s*<([^<>\s]+@[^<>\s]+)>$/);
    const address = named ? { name: named[1].trim().replace(/^"|"$/g, ''), address: named[2].toLowerCase() } : { address: item.toLowerCase() };
    if (strict && (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address.address) || /[\r\n]/.test(item))) throw new Error(`Confira o destinatário: ${item}`);
    return address;
  });
}
export function addressInput(addresses: MailAddress[]) { return addresses.map(a => a.name ? `${a.name} <${a.address}>` : a.address).join('; '); }
export function attachmentSize(a: AttachmentPayload) { return Math.floor(a.contentBase64.length * 3 / 4) - (a.contentBase64.endsWith('==') ? 2 : a.contentBase64.endsWith('=') ? 1 : 0); }
export function assertPayloadSize(payload: unknown) {
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > MAX_REQUEST_BYTES) throw new Error('A mensagem completa ultrapassa 25 MiB. Reduza o texto ou os anexos.');
}
export function filePayload(file: File): Promise<AttachmentPayload> {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
    reader.onload = () => resolve({filename:file.name,mimeType:file.type||'application/octet-stream',contentBase64:String(reader.result).split(',')[1] ?? ''});
    reader.readAsDataURL(file);
  });
}
export function payloadFile(a: AttachmentPayload): File {
  const bytes=Uint8Array.from(atob(a.contentBase64),c=>c.charCodeAt(0));
  return new File([bytes],a.filename,{type:a.mimeType});
}
