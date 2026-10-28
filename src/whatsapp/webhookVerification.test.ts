import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyChallenge, verifyPostSignature } from '../../supabase/functions/_shared/whatsapp/webhookVerification';

const secret = 'synthetic-test-app-secret';
const verifyToken = 'synthetic-verify-token';
const body = new TextEncoder().encode('{"entry":[{"id":"synthetic"}]}');
const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('verifyChallenge', () => {
  it('returns the challenge only for a matching subscribe request', () => {
    const url = new URL(`https://example.test/webhook?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=12345`);
    expect(verifyChallenge(url, verifyToken)).toBe('12345');
  });

  it('rejects mismatched tokens, modes and missing challenges', () => {
    expect(verifyChallenge(new URL('https://example.test/?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=123'), verifyToken)).toBeNull();
    expect(verifyChallenge(new URL(`https://example.test/?hub.mode=unsubscribe&hub.verify_token=${verifyToken}&hub.challenge=123`), verifyToken)).toBeNull();
    expect(verifyChallenge(new URL(`https://example.test/?hub.mode=subscribe&hub.verify_token=${verifyToken}`), verifyToken)).toBeNull();
  });
});

describe('verifyPostSignature', () => {
  it('accepts an HMAC over the exact raw request bytes', async () => {
    expect(await verifyPostSignature(body, signature, secret)).toBe(true);
  });

  it('rejects a changed body and malformed or absent signatures', async () => {
    expect(await verifyPostSignature(new TextEncoder().encode('{}'), signature, secret)).toBe(false);
    expect(await verifyPostSignature(body, null, secret)).toBe(false);
    expect(await verifyPostSignature(body, signature.slice(7), secret)).toBe(false);
    expect(await verifyPostSignature(body, 'sha256=abcd', secret)).toBe(false);
  });
});
