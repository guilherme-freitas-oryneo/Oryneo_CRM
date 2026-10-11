-- Federal fixed-date holidays only. Optional days and local holidays are excluded.
create table public.crm_business_calendar (
 id boolean primary key default true check(id),
 timezone text not null default 'America/Sao_Paulo' check(timezone='America/Sao_Paulo'),
 weekdays integer[] not null default array[1,2,3,4,5] check(weekdays=array[1,2,3,4,5]),
 opens_at time not null default time '09:00' check(opens_at=time '09:00'),
 closes_at time not null default time '18:00' check(closes_at=time '18:00'),
 holiday_scope text not null default 'national' check(holiday_scope='national')
);
insert into public.crm_business_calendar(id) values(true);
alter table public.crm_business_calendar enable row level security;
revoke all on public.crm_business_calendar from anon,authenticated;
grant select on public.crm_business_calendar to authenticated;
create policy crm_calendar_active_read on public.crm_business_calendar for select to authenticated
using (exists(select 1 from public.crm_members m where m.user_id=auth.uid() and m.status='active'));

create function public.crm_is_business_time(p_at timestamptz)
returns boolean language sql stable security invoker set search_path=''
as $$
 select exists(
  select 1 from public.crm_business_calendar c
  where extract(isodow from p_at at time zone c.timezone)::int=any(c.weekdays)
   and (p_at at time zone c.timezone)::time>=c.opens_at
   and (p_at at time zone c.timezone)::time<c.closes_at
   and to_char(p_at at time zone c.timezone,'MM-DD') not in
   ('01-01','04-21','05-01','09-07','10-12','11-02','11-15','11-20','12-25')
 )
$$;
revoke all on function public.crm_is_business_time(timestamptz) from public,anon,authenticated;
grant execute on function public.crm_is_business_time(timestamptz) to authenticated;
