import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const migration=()=>readFileSync(resolve(process.cwd(),
  'supabase/migrations/20261102235347_oryneo_operational_review_drafts.sql'),'utf8');

describe('operational review draft migration',()=>{
  it('adds a CRM-review draft for each of the eight journeys without touching live ownership',()=>{
    const sql=migration();
    expect(sql).toMatch(/starter-new-opportunity/);
    expect(sql).toMatch(/starter-talk-to-us/);
    expect(sql).toMatch(/starter-direct-checkout/);
    expect(sql).toMatch(/starter-payment-confirmed/);
    expect(sql).toMatch(/starter-diagnosis/);
    expect(sql).toMatch(/starter-proposal/);
    expect(sql).toMatch(/starter-follow-up/);
    expect(sql).toMatch(/starter-conversational-sdr/);
    expect(sql).toMatch(/crm_task/);
    expect(sql).toMatch(/'draft'/);
    expect(sql).not.toMatch(/UPDATE public\.automation_channel_ownership/i);
    expect(sql).not.toMatch(/SET enabled\s*=\s*true/i);
    expect(sql).not.toMatch(/published_version_id\s*=/i);
  });
});
