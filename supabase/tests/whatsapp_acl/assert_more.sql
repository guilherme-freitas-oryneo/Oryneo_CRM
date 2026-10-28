reset role;
insert into public.crm_wa_conversations(channel_id,customer_wa_id)
select id,'5521888888888' from public.crm_wa_channels;
insert into public.crm_wa_messages(conversation_id,provider_message_id,direction,kind,body,occurred_at)
select id,'wamid.local2','inbound','text','local test 2',now()
from public.crm_wa_conversations where customer_wa_id='5521888888888';
set role authenticated;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';
do $$begin
  if (select count(*) from public.crm_wa_conversations) <> 1 then raise exception 'viewer sees unassigned conversation'; end if;
  if (select count(*) from public.crm_wa_messages) <> 1 then raise exception 'viewer sees unassigned message'; end if;
  begin
    insert into public.crm_wa_access(user_id,channel_id,role) select '00000000-0000-4000-8000-000000000003',id,'admin' from public.crm_wa_channels;
    raise exception 'viewer can grant access';
  exception when insufficient_privilege then null;
  end;
end$$;
set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001';
do $$begin
  if (select count(*) from public.crm_wa_conversations) <> 2 then raise exception 'admin cannot see both conversations'; end if;
end$$;
