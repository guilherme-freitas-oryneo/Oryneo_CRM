import { verifyChallenge, verifyPostSignature } from './webhookVerification.ts';

const MAX_BODY_BYTES = 256 * 1024;

export interface WebhookEvent {
  eventSha256: string;
  payload: Record<string, unknown>;
}

export interface WebhookDependencies {
  appSecret: string;
  verifyToken: string;
  persist(event: WebhookEvent): Promise<void>;
}

function response(status: number, body = ''): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

async function readLimitedBody(request: Request): Promise<Uint8Array | null> {
  const statedLength = request.headers.get('content-length');
  if (statedLength && Number(statedLength) > MAX_BODY_BYTES) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.byteLength;
  }
  return bytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Acknowledge only after a valid, signed event has been committed to durable storage. */
export function createWhatsAppWebhookHandler(dependencies: WebhookDependencies): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'GET') {
      const challenge = verifyChallenge(new URL(request.url), dependencies.verifyToken);
      return challenge === null ? response(403, 'Forbidden') : response(200, challenge);
    }
    if (request.method !== 'POST') return response(405, 'Method Not Allowed');
    let raw: Uint8Array | null;
    try {
      raw = await readLimitedBody(request);
    } catch {
      return response(400, 'Invalid body');
    }
    if (raw === null) return response(413, 'Payload Too Large');
    if (!await verifyPostSignature(raw, request.headers.get('x-hub-signature-256'), dependencies.appSecret)) return response(401, 'Unauthorized');
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
    } catch {
      return response(400, 'Invalid JSON');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || (payload as Record<string, unknown>).object !== 'whatsapp_business_account'
      || !Array.isArray((payload as Record<string, unknown>).entry)) return response(400, 'Invalid event');
    try {
      await dependencies.persist({ eventSha256: await sha256Hex(raw), payload: payload as Record<string, unknown> });
    } catch {
      return response(503, 'Temporarily Unavailable');
    }
    return response(200, 'EVENT_RECEIVED');
  };
}
