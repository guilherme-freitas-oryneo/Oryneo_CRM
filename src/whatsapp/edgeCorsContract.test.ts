import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('WhatsApp Edge CORS contract', () => {
  it.each(['whatsapp-inbox', 'whatsapp-media'])('allows the Supabase browser client header in %s', functionName => {
    const source = readFileSync(`supabase/functions/${functionName}/index.ts`, 'utf8');
    expect(source).toMatch(/Access-Control-Allow-Headers[^\n]+x-client-info/i);
  });
});
