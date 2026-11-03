const path=new URL('../../migrations/20261103123000_oryneo_commercial_shadow_source_grants.sql',import.meta.url);
const assert=(value:boolean,message:string)=>{if(!value)throw new Error(message);};

Deno.test('commercial shadow adapter receives read-only access to every canonical source',async()=>{
  const sql=await Deno.readTextFile(path);
  for(const table of ['crm_intake_requests','crm_billing_orders','crm_stripe_events','crm_events','crm_proposals','crm_wa_automation_events','crm_delivery_projects'])
    assert(sql.includes(`public.${table}`),`missing read grant for ${table}`);
  assert(!/GRANT\s+(ALL|INSERT|UPDATE|DELETE)/i.test(sql),'shadow source grants must remain read-only');
});
