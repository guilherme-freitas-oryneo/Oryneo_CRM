alter table public.crm_members
 add column last_seen_at timestamptz,
 add column last_session_seconds bigint,
 add column avatar_path text;

create table public.crm_presence_sessions (
 user_id uuid not null references public.crm_members(user_id) on delete cascade,
 client_id uuid not null,
 online_since_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 expires_at timestamptz not null,
 primary key(user_id,client_id)
);
create index crm_presence_live on public.crm_presence_sessions(expires_at,user_id);
alter table public.crm_presence_sessions enable row level security;
revoke all on public.crm_presence_sessions from anon,authenticated;

create function public.crm_presence_ping(p_client_id uuid)
returns timestamptz language plpgsql security definer set search_path=''
as $$
declare ping_at timestamptz:=now(); expired_start timestamptz; expired_last timestamptz;
begin
 if private.crm_role() is null or p_client_id is null then
  raise exception 'Acesso não autorizado.' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(784916,hashtext(auth.uid()::text));
 select online_since_at,last_seen_at into expired_start,expired_last
 from public.crm_presence_sessions where user_id=auth.uid() and expires_at<=ping_at
 order by last_seen_at desc limit 1;
 if expired_start is not null then
  update public.crm_members set last_session_seconds=greatest(0,extract(epoch from expired_last-expired_start)::bigint)
  where user_id=auth.uid();
 end if;
 delete from public.crm_presence_sessions where user_id=auth.uid() and expires_at<=ping_at;
 if not exists(select 1 from public.crm_presence_sessions where user_id=auth.uid() and client_id=p_client_id)
  and (select count(*) from public.crm_presence_sessions where user_id=auth.uid())>=8 then
  raise exception 'Limite de sessões simultâneas atingido.' using errcode='54000';
 end if;
 insert into public.crm_presence_sessions(user_id,client_id,online_since_at,last_seen_at,expires_at)
 values(auth.uid(),p_client_id,ping_at,ping_at,ping_at+interval '25 seconds')
 on conflict(user_id,client_id) do update set
  online_since_at=case when public.crm_presence_sessions.expires_at<ping_at
    then ping_at else public.crm_presence_sessions.online_since_at end,
  last_seen_at=ping_at,expires_at=ping_at+interval '25 seconds';
 update public.crm_members set last_seen_at=ping_at where user_id=auth.uid();
 return ping_at;
end $$;

create function public.crm_presence_leave(p_client_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare started_at timestamptz; leave_at timestamptz:=now();
begin
 if auth.uid() is null or p_client_id is null then
  raise exception 'Acesso não autorizado.' using errcode='42501';
 end if;
 delete from public.crm_presence_sessions
 where user_id=auth.uid() and client_id=p_client_id
 returning online_since_at into started_at;
 update public.crm_members set last_seen_at=leave_at,
  last_session_seconds=case when started_at is not null
    then greatest(0,extract(epoch from leave_at-started_at)::bigint)
    else last_session_seconds end
 where user_id=auth.uid();
end $$;

create function public.crm_list_presence()
returns table(
 user_id uuid,display_name text,directory_email text,role text,status text,
 avatar_path text,online boolean,last_seen_at timestamptz,
 online_since_at timestamptz,last_session_seconds bigint
)
language plpgsql stable security definer set search_path=''
as $$
begin
 if private.crm_role() is distinct from 'admin' then
  raise exception 'Acesso não autorizado.' using errcode='42501';
 end if;
 return query
 select m.user_id,m.display_name,m.directory_email,m.role,m.status,m.avatar_path,
  m.status='active' and exists(select 1 from public.crm_presence_sessions p
    where p.user_id=m.user_id and p.expires_at>now()),
  m.last_seen_at,
  (select min(p.online_since_at) from public.crm_presence_sessions p
    where p.user_id=m.user_id and p.expires_at>now()),
  coalesce((select greatest(0,extract(epoch from p.last_seen_at-p.online_since_at)::bigint)
    from public.crm_presence_sessions p where p.user_id=m.user_id and p.expires_at<=now()
    and p.last_seen_at>=m.last_seen_at order by p.last_seen_at desc limit 1),m.last_session_seconds)
 from public.crm_members m order by m.display_name nulls last,m.directory_email;
end $$;

revoke all on function public.crm_presence_ping(uuid),public.crm_presence_leave(uuid),
 public.crm_list_presence() from public,anon,authenticated;
grant execute on function public.crm_presence_ping(uuid),public.crm_presence_leave(uuid),
 public.crm_list_presence() to authenticated;
