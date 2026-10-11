-- Foundation only. Do not deploy separately from the read/write authorization
-- migration and compatible frontend: existing member-wide policies remain active.

do $$
begin
  if (
    select count(*) from public.crm_members m
    join auth.users u on u.id=m.user_id
    where lower(u.email)=lower('guilherme.freitas@oryneo.com.br')
  )<>1 or (select count(*) from public.crm_members)<>1 then
    raise exception 'Bootstrap admin ambíguo: associação única não confirmada.';
  end if;
end $$;

alter table public.crm_members
  add column role text not null default 'viewer'
    constraint crm_members_role_check check (role in ('admin','commercial','support','viewer')),
  add column status text not null default 'active'
    constraint crm_members_status_check check (status in ('active','suspended')),
  add column display_name text,
  add column directory_email text,
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

update public.crm_members m
set role='admin',directory_email=u.email
from auth.users u
where m.user_id=u.id and lower(u.email)=lower('guilherme.freitas@oryneo.com.br');

create unique index crm_members_directory_email_unique
  on public.crm_members (lower(directory_email))
  where directory_email is not null;

alter table public.crm_records
  add column owner_user_id uuid references auth.users(id),
  add constraint crm_records_stage_has_no_owner
    check (kind<>'stage' or owner_user_id is null);

create index crm_records_active_owner
  on public.crm_records(owner_user_id,created_at desc)
  where kind='deal' and not deleted;

revoke insert,update,delete on public.crm_members from anon,authenticated;
