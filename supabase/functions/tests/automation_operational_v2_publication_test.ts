const migrationPath=new URL('../../migrations/20261103120000_oryneo_operational_v2_shadow_publication.sql',import.meta.url);
const assert=(value:boolean,message:string)=>{if(!value)throw new Error(message);};

Deno.test('operational v2 publication is RPC-guarded and grants only CRM event observation',async()=>{
  const sql=await Deno.readTextFile(migrationPath);
  assert(sql.includes('GRANT SELECT ON TABLE public.crm_events TO service_role'),
    'shadow CRM reader needs the minimum missing SELECT grant');
  assert(sql.includes('automation_shadow_control'),'publication must enter and leave safe stopped mode through its RPC');
  assert(sql.includes('automation_publish_disabled'),'publication must use the immutable publication RPC');
  assert(!/UPDATE\s+public\.automation_flows\s+SET\s+published_version_id/i.test(sql),
    'migration must not bypass version publication rules');
  for(const slug of [
    'starter-new-opportunity','starter-talk-to-us','starter-diagnosis','starter-proposal',
    'starter-direct-checkout','starter-payment-confirmed','starter-follow-up','starter-conversational-sdr',
  ]) assert(sql.includes(`'${slug}'`),`missing ${slug}`);
});
