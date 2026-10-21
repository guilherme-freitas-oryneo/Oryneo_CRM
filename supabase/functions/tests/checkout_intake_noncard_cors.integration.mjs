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

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});
