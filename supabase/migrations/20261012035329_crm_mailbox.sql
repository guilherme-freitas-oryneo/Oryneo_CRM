-- ORYNEO shared mailbox. Credentials are provisioned separately in Supabase Vault.
create extension if not exists pgcrypto with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table public.crm_mailboxes (
  id uuid primary key default gen_random_uuid(),
  address text not null check (address = lower(address) and length(address) between 3 and 254),
  display_name text not null default 'ORYNEO' check (length(display_name) <= 160),
  imap_host text not null default 'imap.hostinger.com' check (length(imap_host) <= 255),
  imap_port integer not null default 993 check (imap_port = 993),
  smtp_host text not null default 'smtp.hostinger.com' check (length(smtp_host) <= 255),
  smtp_port integer not null default 465 check (smtp_port = 465),
  password_secret_name text not null default 'oryneo_mail_password' check (password_secret_name ~ '^[a-z0-9_]{3,80}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index crm_mailboxes_address_unique on public.crm_mailboxes (lower(address));

create table public.crm_mail_folders (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.crm_mailboxes(id) on delete cascade,
  remote_name text not null check (length(remote_name) between 1 and 1000),
  name text not null check (length(name) between 1 and 160),
  delimiter text check (delimiter is null or length(delimiter) between 1 and 4),
  special_use text not null default 'other' check (special_use in ('inbox','sent','drafts','archive','junk','trash','other')),
  uid_validity bigint not null default 0 check (uid_validity >= 0),
  uid_next bigint not null default 1 check (uid_next >= 1),
  highest_modseq bigint check (highest_modseq is null or highest_modseq >= 0),
  last_synced_uid bigint not null default 0 check (last_synced_uid >= 0),
  history_before_uid bigint check (history_before_uid is null or history_before_uid >= 1),
  total_count integer not null default 0 check (total_count >= 0),
  unread_count integer not null default 0 check (unread_count >= 0),
  sync_state text not null default 'pending' check (sync_state in ('pending','syncing','ready','error')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox_id, remote_name)
);
create index crm_mail_folders_mailbox_use on public.crm_mail_folders(mailbox_id, special_use);

create table public.crm_mail_threads (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.crm_mailboxes(id) on delete cascade,
  subject text not null default '' check (length(subject) <= 998),
  subject_normalized text not null default '' check (length(subject_normalized) <= 998),
  participants jsonb not null default '[]'::jsonb check (jsonb_typeof(participants)='array'),
  snippet text not null default '' check (length(snippet) <= 500),
  last_message_at timestamptz not null default now(),
  message_count integer not null default 0 check (message_count >= 0),
  unread_count integer not null default 0 check (unread_count >= 0),
  starred boolean not null default false,
  has_attachments boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_mail_threads_mailbox_recent on public.crm_mail_threads(mailbox_id, last_message_at desc, id desc);
create index crm_mail_threads_subject on public.crm_mail_threads(mailbox_id, subject_normalized);

create table public.crm_mail_messages (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.crm_mailboxes(id) on delete cascade,
  thread_id uuid not null references public.crm_mail_threads(id) on delete cascade,
  internet_message_id text not null default '' check (length(internet_message_id) <= 998),
  content_fingerprint text not null check (content_fingerprint ~ '^[a-f0-9]{64}$'),
  in_reply_to text check (in_reply_to is null or length(in_reply_to) <= 998),
  reference_ids text[] not null default '{}',
  subject text not null default '' check (length(subject) <= 998),
  sender jsonb not null check (jsonb_typeof(sender)='object'),
  recipients_to jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients_to)='array'),
  recipients_cc jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients_cc)='array'),
  recipients_bcc jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients_bcc)='array'),
  participant_emails text[] not null default '{}',
  sent_at timestamptz,
  received_at timestamptz not null default now(),
  body_text text not null default '' check (octet_length(body_text) <= 10485760),
  body_html text not null default '' check (octet_length(body_html) <= 10485760),
  snippet text not null default '' check (length(snippet) <= 500),
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  has_attachments boolean not null default false,
  direction text not null check (direction in ('inbound','outbound')),
  search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(subject,'') || ' ' || coalesce(snippet,'') || ' ' || coalesce(body_text,''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index crm_mail_messages_content_fingerprint_unique on public.crm_mail_messages(mailbox_id, content_fingerprint);
create index crm_mail_messages_internet_id on public.crm_mail_messages(mailbox_id, internet_message_id) where internet_message_id <> '';
create index crm_mail_messages_thread_date on public.crm_mail_messages(thread_id, received_at, id);
create index crm_mail_messages_participants on public.crm_mail_messages using gin(participant_emails);
create index crm_mail_messages_search_vector on public.crm_mail_messages using gin(search_vector);

create table public.crm_mail_locations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.crm_mail_messages(id) on delete cascade,
  folder_id uuid not null references public.crm_mail_folders(id) on delete cascade,
  uid_validity bigint not null check (uid_validity >= 1),
  uid bigint not null check (uid >= 1),
  flags text[] not null default '{}',
  modseq bigint check (modseq is null or modseq >= 0),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(folder_id, uid_validity, uid)
);
create index crm_mail_locations_message_active on public.crm_mail_locations(message_id, folder_id) where removed_at is null;
create index crm_mail_locations_folder_active on public.crm_mail_locations(folder_id, uid desc) where removed_at is null;
create index crm_mail_locations_flags on public.crm_mail_locations using gin(flags);

create table public.crm_mail_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.crm_mail_messages(id) on delete cascade,
  filename text not null check (length(filename) between 1 and 500),
  mime_type text not null check (length(mime_type) between 1 and 255),
  size_bytes bigint not null check (size_bytes between 0 and 26214400),
  content_id text check (content_id is null or length(content_id) <= 998),
  inline boolean not null default false,
  storage_path text not null check (length(storage_path) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique(message_id, storage_path)
);
create index crm_mail_attachments_message on public.crm_mail_attachments(message_id);

create table public.crm_mail_drafts (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.crm_mailboxes(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  thread_id uuid references public.crm_mail_threads(id) on delete set null,
  reply_to_message_id uuid references public.crm_mail_messages(id) on delete set null,
  recipients_to jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients_to)='array'),
  recipients_cc jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients_cc)='array'),
  recipients_bcc jsonb not null default '[]'::jsonb check (jsonb_typeof(recipients_bcc)='array'),
  subject text not null default '' check (length(subject) <= 998),
  body_text text not null default '' check (octet_length(body_text) <= 10485760),
  body_html text not null default '' check (octet_length(body_html) <= 10485760),
  attachment_manifest jsonb not null default '[]'::jsonb check (jsonb_typeof(attachment_manifest)='array'),
  remote_uid bigint check (remote_uid is null or remote_uid >= 1),
  state text not null default 'active' check (state in ('active','sending','sent','discarded')),
  revision bigint not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_mail_drafts_mailbox_updated on public.crm_mail_drafts(mailbox_id, updated_at desc) where state='active';

create table public.crm_mail_outbox (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.crm_mailboxes(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  draft_id uuid references public.crm_mail_drafts(id) on delete set null,
  message_id uuid references public.crm_mail_messages(id) on delete set null,
  idempotency_key uuid not null unique,
  internet_message_id text not null unique check (length(internet_message_id) <= 998),
  payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text) <= 25165824),
  state text not null default 'pending' check (state in ('pending','sending','sent','failed')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_]{2,80}$'),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_mail_outbox_mailbox_state on public.crm_mail_outbox(mailbox_id, state, created_at desc);

create table public.crm_mail_deal_links (
  message_id uuid not null references public.crm_mail_messages(id) on delete cascade,
  deal_id uuid not null references public.crm_records(id) on delete cascade,
  linked_by uuid references auth.users(id),
  automatic boolean not null default false,
  created_at timestamptz not null default now(),
  primary key(message_id, deal_id)
);
create index crm_mail_deal_links_deal on public.crm_mail_deal_links(deal_id, created_at desc);

create table public.crm_mail_sync_runs (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references public.crm_mailboxes(id) on delete cascade,
  state text not null check (state in ('running','success','partial','failed','skipped')),
  trigger_source text not null default 'cron' check (trigger_source in ('cron','manual','bootstrap')),
  folders_processed integer not null default 0 check (folders_processed >= 0),
  messages_imported integer not null default 0 check (messages_imported >= 0),
  flags_updated integer not null default 0 check (flags_updated >= 0),
  backlog integer not null default 0 check (backlog >= 0),
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_]{2,80}$'),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index crm_mail_sync_runs_mailbox_started on public.crm_mail_sync_runs(mailbox_id, started_at desc);

create table public.crm_mailbox_locks (
  mailbox_id uuid primary key references public.crm_mailboxes(id) on delete cascade,
  owner uuid not null,
  locked_until timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.crm_mail_internal_config (
  key text primary key check (key ~ '^[a-z0-9_]{3,80}$'),
  value text not null check (length(value) <= 1000),
  updated_at timestamptz not null default now()
);

create or replace function public.crm_mail_touch_updated_at() returns trigger
language plpgsql set search_path='' as $$
begin
  new.updated_at = now();
  return new;
end
$$;

do $triggers$
declare table_name text;
begin
  foreach table_name in array array['crm_mailboxes','crm_mail_folders','crm_mail_threads','crm_mail_messages','crm_mail_locations','crm_mail_drafts','crm_mail_outbox'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.crm_mail_touch_updated_at()', table_name || '_touch_updated_at', table_name);
  end loop;
end
$triggers$;

insert into public.crm_mailboxes(address, display_name)
select 'contato@oryneo.com.br', 'ORYNEO'
where not exists (select 1 from public.crm_mailboxes where lower(address)='contato@oryneo.com.br');

do $rls$
declare table_name text;
begin
  foreach table_name in array array[
    'crm_mailboxes','crm_mail_folders','crm_mail_threads','crm_mail_messages','crm_mail_locations',
    'crm_mail_attachments','crm_mail_drafts','crm_mail_outbox','crm_mail_deal_links',
    'crm_mail_sync_runs','crm_mailbox_locks','crm_mail_internal_config'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
  end loop;
end
$rls$;

create or replace function public.crm_mail_is_member() returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.crm_members where user_id=(select auth.uid()))
$$;
revoke all on function public.crm_mail_is_member() from public, anon;
grant execute on function public.crm_mail_is_member() to authenticated;

do $policies$
declare table_name text;
begin
  foreach table_name in array array[
    'crm_mailboxes','crm_mail_folders','crm_mail_threads','crm_mail_messages','crm_mail_locations',
    'crm_mail_attachments','crm_mail_drafts','crm_mail_outbox','crm_mail_deal_links','crm_mail_sync_runs'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using ((select public.crm_mail_is_member()))', table_name || '_member_read', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
  end loop;
end
$policies$;

create or replace function public.crm_mail_list_threads(
  p_folder uuid default null,
  p_query text default '',
  p_filter text default 'all',
  p_before_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
) returns table(
  id uuid, subject text, participants jsonb, preview text, last_message_at timestamptz,
  unread boolean, starred boolean, has_attachments boolean, message_count integer, deal_links jsonb
) language sql stable security invoker set search_path='' as $$
  select t.id, t.subject, t.participants, t.snippet, t.last_message_at,
    t.unread_count > 0, t.starred, t.has_attachments, t.message_count,
    coalesce((
      select jsonb_agg(distinct jsonb_build_object('deal_id', r.id, 'deal_title', r.data->>'title', 'automatic', l.automatic))
      from public.crm_mail_messages m
      join public.crm_mail_deal_links l on l.message_id=m.id
      join public.crm_records r on r.id=l.deal_id and not r.deleted
      where m.thread_id=t.id
    ), '[]'::jsonb)
  from public.crm_mail_threads t
  where (select public.crm_mail_is_member())
    and (p_folder is null or exists(
      select 1 from public.crm_mail_messages m join public.crm_mail_locations l on l.message_id=m.id
      where m.thread_id=t.id and l.folder_id=p_folder and l.removed_at is null
    ))
    and (coalesce(trim(p_query),'')='' or exists(
      select 1 from public.crm_mail_messages m where m.thread_id=t.id
        and m.search_vector @@ websearch_to_tsquery('simple'::regconfig, p_query)
    ))
    and (p_filter='all' or (p_filter='unread' and t.unread_count>0) or (p_filter='starred' and t.starred) or (p_filter='attachments' and t.has_attachments))
    and (p_before_at is null or (t.last_message_at,t.id)<(p_before_at,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
  order by t.last_message_at desc, t.id desc
  limit least(greatest(coalesce(p_limit,50),1),50)
$$;

create or replace function public.crm_mail_get_thread(p_thread uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select case when not (select public.crm_mail_is_member()) then null else jsonb_build_object(
    'thread', to_jsonb(t),
    'messages', coalesce((
      select jsonb_agg((to_jsonb(m)-'search_vector') || jsonb_build_object(
        'attachments', coalesce((select jsonb_agg(to_jsonb(a)-'storage_path') from public.crm_mail_attachments a where a.message_id=m.id),'[]'::jsonb),
        'locations', coalesce((select jsonb_agg(jsonb_build_object('folder_id',l.folder_id,'flags',l.flags,'uid',l.uid)) from public.crm_mail_locations l where l.message_id=m.id and l.removed_at is null),'[]'::jsonb)
      ) order by m.received_at,m.id)
      from public.crm_mail_messages m where m.thread_id=t.id
    ),'[]'::jsonb)
  ) end
  from public.crm_mail_threads t where t.id=p_thread
$$;

create or replace function public.crm_mail_get_status() returns jsonb
language sql stable security invoker set search_path='' as $$
  select case when not (select public.crm_mail_is_member()) then null else jsonb_build_object(
    'mailbox_id', m.id,
    'address', m.address,
    'backlog', coalesce((select sum(greatest(f.uid_next-1-f.last_synced_uid,0)) from public.crm_mail_folders f where f.mailbox_id=m.id),0),
    'last_run', (select to_jsonb(r) from public.crm_mail_sync_runs r where r.mailbox_id=m.id order by r.started_at desc limit 1)
  ) end
  from public.crm_mailboxes m where m.active order by m.created_at limit 1
$$;

create or replace function public.crm_mail_get_credentials(p_mailbox_id uuid)
returns table(address text, display_name text, imap_host text, imap_port integer, smtp_host text, smtp_port integer, password text)
language sql stable security definer set search_path='' as $$
  select m.address,m.display_name,m.imap_host,m.imap_port,m.smtp_host,m.smtp_port,s.decrypted_secret
  from public.crm_mailboxes m
  join vault.decrypted_secrets s on s.name=m.password_secret_name
  where m.id=p_mailbox_id and m.active
$$;

create or replace function public.crm_mail_verify_cron(p_token text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select c.value = encode(extensions.digest(p_token,'sha256'),'hex') from public.crm_mail_internal_config c where c.key='cron_secret_sha256'),false)
$$;

create or replace function public.crm_mail_claim_lock(p_mailbox_id uuid, p_owner uuid, p_seconds integer default 130) returns boolean
language plpgsql security definer set search_path='' as $$
declare acquired boolean;
begin
  if p_seconds not between 30 and 180 then raise exception 'Invalid lock duration'; end if;
  insert into public.crm_mailbox_locks(mailbox_id,owner,locked_until)
  values(p_mailbox_id,p_owner,now()+make_interval(secs=>p_seconds))
  on conflict(mailbox_id) do update set owner=excluded.owner,locked_until=excluded.locked_until,updated_at=now()
  where public.crm_mailbox_locks.locked_until<now() or public.crm_mailbox_locks.owner=p_owner
  returning true into acquired;
  return coalesce(acquired,false);
end
$$;

create or replace function public.crm_mail_release_lock(p_mailbox_id uuid, p_owner uuid) returns void
language sql security definer set search_path='' as $$
  delete from public.crm_mailbox_locks where mailbox_id=p_mailbox_id and owner=p_owner
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
    unread_count=(select count(distinct m.id) from public.crm_mail_messages m join public.crm_mail_locations l on l.message_id=m.id where m.thread_id=p_thread and l.removed_at is null and not ('\\Seen'=any(l.flags))),
    starred=exists(select 1 from public.crm_mail_messages m join public.crm_mail_locations l on l.message_id=m.id where m.thread_id=p_thread and l.removed_at is null and '\\Flagged'=any(l.flags)),
    has_attachments=exists(select 1 from public.crm_mail_messages m join public.crm_mail_attachments a on a.message_id=m.id where m.thread_id=p_thread)
  where t.id=p_thread;
end
$$;

revoke all on function public.crm_mail_touch_updated_at() from public, anon, authenticated;
revoke all on function public.crm_mail_get_credentials(uuid) from public, anon, authenticated;
revoke all on function public.crm_mail_verify_cron(text) from public, anon, authenticated;
revoke all on function public.crm_mail_claim_lock(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.crm_mail_release_lock(uuid,uuid) from public, anon, authenticated;
revoke all on function public.crm_mail_refresh_thread(uuid) from public, anon, authenticated;
grant execute on function public.crm_mail_get_credentials(uuid) to service_role;
grant execute on function public.crm_mail_verify_cron(text) to service_role;
grant execute on function public.crm_mail_claim_lock(uuid,uuid,integer) to service_role;
grant execute on function public.crm_mail_release_lock(uuid,uuid) to service_role;
grant execute on function public.crm_mail_refresh_thread(uuid) to service_role;

revoke all on function public.crm_mail_list_threads(uuid,text,text,timestamptz,uuid,integer) from public, anon;
revoke all on function public.crm_mail_get_thread(uuid) from public, anon;
revoke all on function public.crm_mail_get_status() from public, anon;
grant execute on function public.crm_mail_list_threads(uuid,text,text,timestamptz,uuid,integer) to authenticated;
grant execute on function public.crm_mail_get_thread(uuid) to authenticated;
grant execute on function public.crm_mail_get_status() to authenticated;

insert into storage.buckets(id,name,public,file_size_limit)
values('crm-mail-attachments','crm-mail-attachments',false,15728640)
on conflict(id) do update set public=false,file_size_limit=15728640;

create policy crm_mail_attachments_member_read on storage.objects for select to authenticated
using(bucket_id='crm-mail-attachments' and (select public.crm_mail_is_member()));

alter table public.crm_mail_folders replica identity full;
alter table public.crm_mail_threads replica identity full;
alter table public.crm_mail_messages replica identity full;
alter table public.crm_mail_locations replica identity full;
alter table public.crm_mail_drafts replica identity full;
alter table public.crm_mail_outbox replica identity full;
alter table public.crm_mail_sync_runs replica identity full;

do $realtime$
declare table_name text;
begin
  foreach table_name in array array['crm_mail_folders','crm_mail_threads','crm_mail_messages','crm_mail_locations','crm_mail_drafts','crm_mail_outbox','crm_mail_sync_runs'] loop
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=table_name) then
      execute format('alter publication supabase_realtime add table public.%I',table_name);
    end if;
  end loop;
end
$realtime$;
