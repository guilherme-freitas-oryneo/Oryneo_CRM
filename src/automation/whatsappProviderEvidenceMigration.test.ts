import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const migration=()=>readFileSync(resolve(process.cwd(),
  'supabase/migrations/20261103003445_oryneo_whatsapp_provider_evidence.sql'),'utf8');

describe('WhatsApp provider evidence migration',()=>{
  it('only records a matching active Meta sender and does not release the channel',()=>{
    const sql=migration();
    expect(sql).toMatch(/crm_wa_channels/);
    expect(sql).toMatch(/phone_number_id/);
    expect(sql).toMatch(/verified_at/);
    expect(sql).toMatch(/enabled\s*=\s*false/i);
    expect(sql).toMatch(/release_approved_at\s*=\s*NULL/i);
    expect(sql).not.toMatch(/UPDATE public\.automation_channel_ownership/i);
    expect(sql).not.toMatch(/mode='live'/i);
    expect(sql).not.toMatch(/legacy_dispatch_paused_at/i);
  });
});
