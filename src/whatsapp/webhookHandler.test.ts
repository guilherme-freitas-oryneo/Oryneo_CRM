import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createWhatsAppWebhookHandler } from '../../supabase/functions/_shared/whatsapp/webhookHandler';

const appSecret = 'synthetic-app-secret';
const verifyToken = 'synthetic-verify-token';
const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba-1', changes: [] }] });

function signedRequest(body = payload, secret = appSecret): Request {
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  return new Request('https://example.test/webhook', {
    method: 'POST', body, headers: { 'x-hub-signature-256': `sha256=${signature}` },
  });
}

function fixture() {
  const persist = vi.fn(async (_event: { eventSha256: string; payload: unknown }) => {});
  const handler = createWhatsAppWebhookHandler({ appSecret, verifyToken, persist });
  return { handler, persist };
}

describe('WhatsApp webhook HTTP handler', () => {
  it('responds to Meta challenge only with the configured token', async () => {
    const { handler, persist } = fixture();
    const accepted = await handler(new Request(`https://example.test/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=123`));
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toBe('123');
    expect((await handler(new Request('https://example.test/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123'))).status).toBe(403);
    expect(persist).not.toHaveBeenCalled();
  });

  it('persists one authenticated event before acknowledging', async () => {
    const { handler, persist } = fixture();
    const response = await handler(signedRequest());
    expect(response.status).toBe(200);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0][0]).toMatchObject({ payload: JSON.parse(payload) });
    expect(persist.mock.calls[0][0].eventSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects altered signatures and malformed payloads without persisting', async () => {
    const { handler, persist } = fixture();
    const altered = signedRequest('{}');
    expect((await handler(altered)).status).toBe(400);
    const unsigned = new Request('https://example.test/webhook', { method: 'POST', body: payload });
    expect((await handler(unsigned)).status).toBe(401);
    const badJson = signedRequest('{');
    expect((await handler(badJson)).status).toBe(400);
    expect(persist).not.toHaveBeenCalled();
  });

  it('does not ACK when persistence fails, so Meta can retry', async () => {
    const { handler, persist } = fixture();
    persist.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await handler(signedRequest())).status).toBe(503);
  });

  it('enforces body limit and does not disclose internal errors', async () => {
    const { handler, persist } = fixture();
    const response = await handler(signedRequest('x'.repeat(262145)));
    expect(response.status).toBe(413);
    expect(persist).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('database');
  });
});
