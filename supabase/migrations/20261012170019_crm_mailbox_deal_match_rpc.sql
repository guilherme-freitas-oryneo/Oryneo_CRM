create or replace function public.crm_mail_find_active_deals_by_emails(p_emails text[])
returns table(id uuid)
language sql stable security definer set search_path='' as $$
  select r.id
  from public.crm_records r
  where r.kind='deal' and not r.deleted
    and cardinality(p_emails) between 1 and 200
    and lower(btrim(r.data->>'email'))=any(p_emails)
  limit 200
$$;

revoke all on function public.crm_mail_find_active_deals_by_emails(text[]) from public, anon, authenticated;
grant execute on function public.crm_mail_find_active_deals_by_emails(text[]) to service_role;

insert into public.crm_mail_deal_links(message_id,deal_id,automatic)
select distinct m.id,r.id,true
from public.crm_mail_messages m
join public.crm_records r on r.kind='deal' and not r.deleted
  and lower(btrim(r.data->>'email'))=any(m.participant_emails)
on conflict(message_id,deal_id) do nothing;
