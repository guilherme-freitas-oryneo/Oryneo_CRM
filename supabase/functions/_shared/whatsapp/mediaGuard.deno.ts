import { readBoundedMedia, safeMediaMime } from './mediaGuard.ts';

Deno.test('media MIME must be allowlisted and agree with persisted metadata', () => {
  if (safeMediaMime('image/png; charset=binary', 'image/png') !== 'image/png') throw new Error('valid image refused');
  if (safeMediaMime('text/html', 'image/png') !== null) throw new Error('HTML accepted');
  if (safeMediaMime('application/pdf', 'image/png') !== null) throw new Error('mismatched MIME accepted');
});

Deno.test('media stream stops at the byte limit even without Content-Length', async () => {
  const small = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2])); c.close(); } });
  const result = await readBoundedMedia(small, 2);
  if (result.length !== 2 || result[1] !== 2) throw new Error('valid stream corrupted');
  const large = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } });
  let rejected = false;
  try { await readBoundedMedia(large, 2); } catch (error) { rejected = error instanceof Error && error.message === 'MEDIA_TOO_LARGE'; }
  if (!rejected) throw new Error('oversized stream accepted');
});
