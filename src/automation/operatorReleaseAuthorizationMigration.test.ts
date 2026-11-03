import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const migration=()=>readFileSync(resolve(process.cwd(),
  'supabase/migrations/20261103005244_oryneo_operator_release_authorization.sql'),'utf8');

describe('operator release authorization migration',()=>{
  it('records authorization without inventing an attestation or releasing a channel',()=>{
    const sql=migration();
    expect(sql).toMatch(/operator_release_authorization_recorded/);
    expect(sql).toMatch(/automation_audit_log/);
    expect(sql).toMatch(/all_channels_requested/);
    expect(sql).not.toMatch(/INSERT INTO public\.automation_release_attestations/i);
    expect(sql).not.toMatch(/UPDATE public\.automation_channel_ownership/i);
    expect(sql).not.toMatch(/mode\s*=\s*'live'/i);
  });
});
