-- Expose location identifiers required for remote flag actions and normalize
-- IMAP system-flag literals to one backslash.
create or replace function public.crm_mail_get_thread(p_thread uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select case when not (select public.crm_mail_is_member()) then null else jsonb_build_object(
    'thread', to_jsonb(t) || jsonb_build_object(
      'deal_links', coalesce((
        select jsonb_agg(distinct jsonb_build_object('deal_id',r.id,'deal_title',r.data->>'title','automatic',l.automatic))
        from public.crm_mail_messages linked_message
        join public.crm_mail_deal_links l on l.message_id=linked_message.id
        join public.crm_records r on r.id=l.deal_id and not r.deleted
        where linked_message.thread_id=t.id
      ),'[]'::jsonb)
    ),
    'messages', coalesce((
      select jsonb_agg((to_jsonb(m)-'search_vector') || jsonb_build_object(
        'attachments', coalesce((select jsonb_agg(to_jsonb(a)-'storage_path') from public.crm_mail_attachments a where a.message_id=m.id),'[]'::jsonb),
        'locations', coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'folder_id',l.folder_id,'flags',l.flags,'uid',l.uid)) from public.crm_mail_locations l where l.message_id=m.id and l.removed_at is null),'[]'::jsonb)
      ) order by m.received_at,m.id)
      from public.crm_mail_messages m where m.thread_id=t.id
    ),'[]'::jsonb)
  ) end
  from public.crm_mail_threads t where t.id=p_thread
$$;

create or replace function public.crm_mail_refresh_thread(p_thread uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  update public.crm_mail_threads t set
    subject=coalesce((select m.subject from public.crm_mail_messages m where m.thread_id=p_thread order by m.received_at desc,m.id desc limit 1),t.subject),
    subject_normalized=lower(regexp_replace(coalesce((select m.subject from public.crm_mail_messages m where m.thread_id=p_thread order by m.received_at desc,m.id desc limit 1),t.subject),'^\s*((re|res|resp|fw|fwd|enc|rv)(\[[0-9]+\])?\s*:\s*)+','','i')),
    snippet=coalesce((select m.snippet from public.crm_mail_messages m where m.thread_id=p_thread order by m.received_at desc,m.id desc limit 1),''),
    last_message_at=coalesce((select max(m.received_at) from public.crm_mail_messages m where m.thread_id=p_thread),t.last_message_at),
    message_count=(select count(*) from public.crm_mail_messages m where m.thread_id=p_thread),
    unread_count=(select count(distinct m.id) from public.crm_mail_messages m join public.crm_mail_locations l on l.message_id=m.id where m.thread_id=p_thread and l.removed_at is null and not (E'\\Seen'=any(l.flags))),
    starred=exists(select 1 from public.crm_mail_messages m join public.crm_mail_locations l on l.message_id=m.id where m.thread_id=p_thread and l.removed_at is null and E'\\Flagged'=any(l.flags)),
    has_attachments=exists(select 1 from public.crm_mail_messages m join public.crm_mail_attachments a on a.message_id=m.id where m.thread_id=p_thread)
  where t.id=p_thread;
end
$$;

revoke all on function public.crm_mail_refresh_thread(uuid) from public, anon, authenticated;
grant execute on function public.crm_mail_refresh_thread(uuid) to service_role;
