create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
create table public.crm_members(user_id uuid primary key references auth.users(id));
alter table public.crm_members enable row level security;
grant select on public.crm_members to authenticated;
create policy member_self on public.crm_members for select to authenticated using(user_id=(select auth.uid()));
create table public.crm_records(id uuid primary key);
insert into auth.users values ('00000000-0000-4000-8000-000000000001');
insert into public.crm_members values ('00000000-0000-4000-8000-000000000001');
