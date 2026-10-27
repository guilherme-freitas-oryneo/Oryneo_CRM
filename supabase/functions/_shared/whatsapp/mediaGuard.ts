export const MAX_WHATSAPP_MEDIA_BYTES = 16 * 1024 * 1024;

const allowedMediaTypes = new Set([
  'image/jpeg', 'image/png', 'audio/mpeg', 'audio/mp4', 'audio/ogg',
  'video/mp4', 'application/pdf',
]);

export function safeMediaMime(metaType: string | undefined, storedType: string | null): string | null {
  const mime = metaType?.split(';')[0].trim().toLowerCase() ?? '';
  const stored = storedType?.split(';')[0].trim().toLowerCase() ?? '';
  if (!allowedMediaTypes.has(mime) || (stored && stored !== mime)) return null;
  return mime;
}

export async function readBoundedMedia(body: ReadableStream<Uint8Array> | null, maxBytes = MAX_WHATSAPP_MEDIA_BYTES): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) throw new Error('MEDIA_BODY_MISSING');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('MEDIA_TOO_LARGE');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}
