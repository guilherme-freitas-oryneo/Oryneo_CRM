function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

/** Verify Meta's GET subscription handshake; this token is distinct from the POST app secret. */
export function verifyChallenge(url: URL, expectedToken: string): string | null {
  if (!expectedToken) return null;
  const params = url.searchParams;
  if (params.getAll('hub.mode').length !== 1 || params.get('hub.mode') !== 'subscribe') return null;
  if (params.getAll('hub.verify_token').length !== 1 || params.getAll('hub.challenge').length !== 1) return null;
  const received = params.get('hub.verify_token') ?? '';
  const challenge = params.get('hub.challenge');
  if (!challenge || !equalBytes(new TextEncoder().encode(received), new TextEncoder().encode(expectedToken))) return null;
  return challenge;
}

/** Verify X-Hub-Signature-256 against the unparsed POST body and Meta app secret. */
export async function verifyPostSignature(rawBody: Uint8Array, header: string | null, appSecret: string): Promise<boolean> {
  if (!appSecret || !header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(rawBody.byteLength);
  bytes.set(rawBody);
  const calculated = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const hex = header.slice(7).toLowerCase();
  const received = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) received[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return equalBytes(calculated, received);
}
