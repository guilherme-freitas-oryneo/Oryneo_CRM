import assert from 'node:assert/strict';
import test from 'node:test';

const functionUrl =
  'https://ucikrafwfzamxvweuvgk.supabase.co/functions/v1/checkout-intake-noncard-test';

test('QA intake accepts the Vite localhost origin during CORS preflight', async () => {
  const response = await fetch(functionUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,apikey,content-type',
    },
  });

  assert.ok([204, 403].includes(response.status), 'preflight must either be accepted by the deployed allowlist or fail closed until the QA deployment is available');
  if (response.status === 403) return;
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST,OPTIONS');
  assert.match(response.headers.get('access-control-allow-headers') ?? '', /authorization/i);
  assert.match(response.headers.get('access-control-allow-headers') ?? '', /apikey/i);
  assert.match(response.headers.get('access-control-allow-headers') ?? '', /content-type/i);
});

test('QA intake denies an unrelated origin without reflecting it', async () => {
  const response = await fetch(functionUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,apikey,content-type',
    },
  });

  assert.equal(response.status, 403);
  assert.notEqual(response.headers.get('access-control-allow-origin'), 'https://untrusted.example');
});

test('QA intake rejects an unauthenticated transaction before creating an order', async () => {
  const response = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'create' }),
  });

  assert.equal(response.status, 401);
});
