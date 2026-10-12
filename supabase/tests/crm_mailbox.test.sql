begin;

do $test$
declare
  v_table_name text;
  expected_tables text[] := array[
    'crm_mailboxes','crm_mail_folders','crm_mail_threads','crm_mail_messages',
    'crm_mail_locations','crm_mail_attachments','crm_mail_drafts','crm_mail_outbox',
    'crm_mail_deal_links','crm_mail_sync_runs','crm_mailbox_locks','crm_mail_internal_config'
  ];
begin
  foreach v_table_name in array expected_tables loop
    if to_regclass('public.' || v_table_name) is null then
      raise exception 'missing table public.%', v_table_name;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=v_table_name and c.relrowsecurity
    ) then
      raise exception 'RLS disabled on public.%', v_table_name;
    end if;
  end loop;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name=any(expected_tables)
      and grantee in ('anon','authenticated') and privilege_type<>'SELECT'
  ) then
    raise exception 'client role has mailbox write privilege';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema='public' and table_name in ('crm_mail_internal_config','crm_mailbox_locks')
      and grantee in ('anon','authenticated')
  ) then
    raise exception 'internal mailbox table exposed';
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='crm_mail_internal_config')
     or not exists (select 1 from pg_policies where schemaname='public' and tablename='crm_mailbox_locks') then
    raise exception 'internal mailbox tables need explicit deny policies';
  end if;

  if exists (
    select 1 from unnest(array[
      'crm_mail_deal_links_linked_by','crm_mail_drafts_created_by','crm_mail_drafts_thread',
      'crm_mail_drafts_reply_to','crm_mail_outbox_created_by','crm_mail_outbox_draft','crm_mail_outbox_message'
    ]) expected(index_name)
    where not exists(select 1 from pg_indexes where schemaname='public' and indexname=expected.index_name)
  ) then
    raise exception 'mailbox foreign-key covering index missing';
  end if;

  if has_function_privilege('authenticated','public.crm_mail_get_credentials(uuid)','execute')
     or has_function_privilege('anon','public.crm_mail_get_credentials(uuid)','execute') then
    raise exception 'credential RPC exposed to clients';
  end if;

  if not has_function_privilege('service_role','public.crm_mail_get_credentials(uuid)','execute') then
    raise exception 'credential RPC unavailable to service role';
  end if;

  if not exists (select 1 from storage.buckets where id='crm-mail-attachments' and not public) then
    raise exception 'private attachment bucket missing';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname='public' and tablename='crm_mail_messages'
      and indexdef ilike '%unique%content_fingerprint%'
  ) then
    raise exception 'message deduplication index missing';
  end if;

  if not exists (
    select 1 from pg_indexes where schemaname='public' and tablename='crm_mail_messages'
      and indexdef ilike '%using gin%search_vector%'
  ) then
    raise exception 'message search index missing';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='crm_mail_threads'
  ) then
    raise exception 'mail threads missing from Realtime publication';
  end if;
end
$test$;

rollback;
