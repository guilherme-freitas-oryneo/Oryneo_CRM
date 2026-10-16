-- F03: client implementation milestones created only after a paid order.
-- No customer-facing completion states are inferred from payment success.
create table public.crm_delivery_projects (
 order_id uuid primary key references public.crm_billing_orders(id) on delete restrict,
 status text not null default 'pending_kickoff'
   check (status in ('pending_kickoff','in_progress','review','completed','paused')),
 started_at timestamptz,
 completed_at timestamptz,
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create table public.crm_delivery_milestones (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.crm_delivery_projects(order_id) on delete restrict,
 position integer not null check (position between 1 and 100),
 title text not null check (length(title) between 2 and 160),
 state text not null default 'pending' check (state in ('pending','in_progress','completed','blocked')),
 due_at timestamptz,
 note text,
 completed_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(order_id,position),
 check (state <> 'completed' or completed_at is not null)
);
create index crm_delivery_milestones_order_position on public.crm_delivery_milestones(order_id,position);
create table public.crm_delivery_audit (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.crm_delivery_projects(order_id) on delete restrict,
 actor uuid references auth.users(id),
 action text not null,
 detail jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index crm_delivery_audit_order_created on public.crm_delivery_audit(order_id,created_at desc);
alter table public.crm_delivery_projects enable row level security;
alter table public.crm_delivery_milestones enable row level security;
alter table public.crm_delivery_audit enable row level security;
revoke all on public.crm_delivery_projects,public.crm_delivery_milestones,public.crm_delivery_audit from public,anon,authenticated;
grant select on public.crm_delivery_projects,public.crm_delivery_milestones,public.crm_delivery_audit to authenticated;
create policy crm_delivery_project_members_read on public.crm_delivery_projects for select to authenticated
 using (exists(select 1 from public.crm_members where user_id=(select auth.uid())));
create policy crm_delivery_milestone_members_read on public.crm_delivery_milestones for select to authenticated
 using (exists(select 1 from public.crm_members where user_id=(select auth.uid())));
create policy crm_delivery_audit_members_read on public.crm_delivery_audit for select to authenticated
 using (exists(select 1 from public.crm_members where user_id=(select auth.uid())));

create or replace function public.crm_create_delivery_on_paid_order()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
 if new.status <> 'paid' then return new; end if;
 insert into public.crm_delivery_projects(order_id) values(new.id) on conflict(order_id) do nothing;
 insert into public.crm_delivery_milestones(order_id,position,title)
 values (new.id,1,'Kickoff e alinhamento do escopo'),
        (new.id,2,'Preparação e configuração do ambiente'),
        (new.id,3,'Validação de acessos e entregáveis')
 on conflict(order_id,position) do nothing;
 return new;
end $$;
revoke all on function public.crm_create_delivery_on_paid_order() from public,anon,authenticated;
create trigger crm_delivery_after_paid
after insert or update of status on public.crm_billing_orders
for each row when (new.status='paid')
execute function public.crm_create_delivery_on_paid_order();

create or replace function public.crm_update_delivery_milestone(
 p_order_id uuid,p_milestone_id uuid,p_state text,p_due_at timestamptz,p_note text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_old public.crm_delivery_milestones; v_new public.crm_delivery_milestones;
begin
 if p_state not in ('pending','in_progress','completed','blocked')
   or p_order_id is null or p_milestone_id is null or p_actor is null
   or length(coalesce(p_note,''))>1000 then
   return jsonb_build_object('ok',false,'reason','invalid_input');end if;
 if not exists (select 1 from public.crm_members where user_id=p_actor)
   then return jsonb_build_object('ok',false,'reason','not_authorized');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,20261017));
 select * into v_old from public.crm_delivery_milestones
  where id=p_milestone_id and order_id=p_order_id for update;
 if not found then return jsonb_build_object('ok',false,'reason','milestone_not_found');end if;
 update public.crm_delivery_milestones
 set state=p_state,due_at=p_due_at,note=nullif(trim(coalesce(p_note,'')),''),
  completed_at=case when p_state='completed' then coalesce(v_old.completed_at,now()) else null end,
  updated_at=now()
 where id=p_milestone_id and order_id=p_order_id returning * into v_new;
 update public.crm_delivery_projects set
  status=case
    when not exists(select 1 from public.crm_delivery_milestones where order_id=p_order_id and state<>'completed')
      then 'completed'
    when exists(select 1 from public.crm_delivery_milestones where order_id=p_order_id and state in ('completed','in_progress'))
      then 'in_progress'
    else 'pending_kickoff' end,
  started_at=case when p_state in ('completed','in_progress')
    then coalesce(started_at,now()) else started_at end,
  completed_at=case when not exists(select 1 from public.crm_delivery_milestones where order_id=p_order_id and state<>'completed')
    then coalesce(completed_at,now()) else null end,
  updated_at=now()
 where order_id=p_order_id;
 insert into public.crm_delivery_audit(order_id,actor,action,detail)
 values (p_order_id,p_actor,'milestone_updated',
   jsonb_build_object('milestone_id',p_milestone_id,'position',v_old.position,'from',v_old.state,'to',v_new.state,
     'old_due_at',v_old.due_at,'new_due_at',v_new.due_at));
 return jsonb_build_object('ok',true,'state',v_new.state);
end $$;
revoke all on function public.crm_update_delivery_milestone(uuid,uuid,text,timestamptz,text,uuid)
 from public,anon,authenticated;
grant execute on function public.crm_update_delivery_milestone(uuid,uuid,text,timestamptz,text,uuid)
 to service_role;
