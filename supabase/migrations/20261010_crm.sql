-- ORYNEO CRM. All business writes are serialized and revision checked.
create table public.crm_members (user_id uuid primary key references auth.users(id) on delete cascade);
create table public.crm_records (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('stage','deal')),
 data jsonb not null check(jsonb_typeof(data)='object'), revision bigint not null default 1,
 deleted boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index crm_records_active_kind on public.crm_records(kind) where not deleted;
create index crm_records_stage on public.crm_records((data->>'stage_id')) where kind='deal' and not deleted;
create table public.crm_history (
 id uuid primary key default gen_random_uuid(), actor uuid not null references auth.users(id),
 record_id uuid not null references public.crm_records(id), before_data jsonb, before_deleted boolean,
 after_revision bigint not null, undone boolean not null default false, created_at timestamptz not null default now()
);
create index crm_history_actor_created on public.crm_history(actor,created_at desc);
create table public.crm_intake_requests (request_id uuid primary key, deal_id uuid not null references public.crm_records(id), fingerprint text not null, created_at timestamptz not null default now());
create index crm_intake_recent on public.crm_intake_requests(fingerprint,created_at);
alter table public.crm_members enable row level security;
alter table public.crm_records enable row level security;
alter table public.crm_history enable row level security;
alter table public.crm_intake_requests enable row level security;
revoke all on public.crm_members, public.crm_records, public.crm_history, public.crm_intake_requests from anon, authenticated;
grant select on public.crm_members,public.crm_records,public.crm_history to authenticated;
create policy member_self on public.crm_members for select to authenticated using(user_id=(select auth.uid()));
create policy member_records on public.crm_records for select to authenticated using(exists(select 1 from public.crm_members where user_id=(select auth.uid())));
create policy own_history on public.crm_history for select to authenticated using(actor=(select auth.uid()) and exists(select 1 from public.crm_members where user_id=(select auth.uid())));

create function public.crm_validate_record() returns trigger language plpgsql set search_path='' as $$
begin
 if octet_length(new.data::text)>24000 then raise exception 'Registro muito longo.'; end if;
 if new.deleted then
  if new.kind='stage' then
   if exists(select 1 from public.crm_records where kind='deal' and not deleted and data->>'stage_id'=new.id::text) then raise exception 'Mova as oportunidades antes de excluir a etapa.'; end if;
   if not exists(select 1 from public.crm_records where kind='stage' and not deleted and id<>new.id and data->>'outcome'='open') then raise exception 'Mantenha ao menos uma etapa aberta.'; end if;
  end if;
  return new;
 end if;
 if new.kind='stage' then
  if coalesce(length(trim(new.data->>'name')),0) not between 1 and 60 or coalesce(new.data->>'color','') !~ '^#[0-9a-fA-F]{6}$' or coalesce(new.data->>'outcome','') not in ('open','won','lost') or jsonb_typeof(new.data->'position') is distinct from 'number' then raise exception 'Etapa inválida.'; end if;
  if new.data->>'outcome'<>'open' and not exists(select 1 from public.crm_records where kind='stage' and not deleted and id<>new.id and data->>'outcome'='open') then raise exception 'Mantenha ao menos uma etapa aberta.'; end if;
 else
  if coalesce(length(trim(new.data->>'title')),0) not between 1 and 160 or coalesce(length(trim(new.data->>'company')),0)>160 or coalesce(length(new.data->>'notes'),0)>12000 or coalesce(length(new.data->>'email'),0)>254 or coalesce(length(new.data->>'phone'),0)>40 or coalesce(length(new.data->>'contact'),0)>160 then raise exception 'Dados da oportunidade inválidos.'; end if;
  if jsonb_typeof(new.data->'value_cents') is distinct from 'number' or (new.data->>'value_cents')::numeric<0 or (new.data->>'value_cents')::numeric>999999999999 or trunc((new.data->>'value_cents')::numeric)<>(new.data->>'value_cents')::numeric then raise exception 'Valor inválido.'; end if;
  if not exists(select 1 from public.crm_records where kind='stage' and not deleted and id::text=new.data->>'stage_id') then raise exception 'A etapa não está mais disponível.'; end if;
 end if;
 new.updated_at=now(); return new;
end $$;
create trigger validate_crm_record before insert or update on public.crm_records for each row execute function public.crm_validate_record();

create function public.crm_mutate(p_id uuid, p_kind text, p_data jsonb, p_revision bigint default 0, p_deleted boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.crm_records; result public.crm_records; operation uuid;
begin
 if not exists(select 1 from public.crm_members where user_id=auth.uid()) then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(784915);
 select * into previous from public.crm_records where id=p_id for update;
 if found then
  if previous.revision<>p_revision or previous.kind<>p_kind then raise exception 'Este registro foi atualizado. Recarregue e tente novamente.'; end if;
  update public.crm_records set data=p_data, deleted=p_deleted,revision=revision+1 where id=p_id returning * into result;
 else
  if p_revision<>0 or p_deleted then raise exception 'Registro indisponível.'; end if;
  insert into public.crm_records(id,kind,data) values(p_id,p_kind,p_data) returning * into result;
 end if;
 insert into public.crm_history(actor,record_id,before_data,before_deleted,after_revision) values(auth.uid(),p_id,previous.data,previous.deleted,result.revision) returning id into operation;
 return operation;
end $$;
create function public.crm_undo(p_operation uuid) returns void language plpgsql security definer set search_path='' as $$
declare h public.crm_history; r public.crm_records;
begin
 if not exists(select 1 from public.crm_members where user_id=auth.uid()) then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(784915);
 select * into h from public.crm_history where id=p_operation and actor=auth.uid() and not undone for update;
 if not found then raise exception 'Esta ação não pode mais ser desfeita.'; end if;
 select * into r from public.crm_records where id=h.record_id for update;
 if r.revision<>h.after_revision then raise exception 'Uma alteração posterior impede desfazer esta ação.'; end if;
 update public.crm_records set data=coalesce(h.before_data,data), deleted=coalesce(h.before_deleted,true),revision=revision+1 where id=r.id;
 update public.crm_history set undone=true where id=h.id;
end $$;

create function public.crm_intake(p_request_id uuid,p_fingerprint text,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; deal uuid;
begin
 perform pg_advisory_xact_lock(784915);
 select deal_id into deal from public.crm_intake_requests where request_id=p_request_id;
 if found then return deal; end if;
 if (select count(*) from public.crm_intake_requests where fingerprint=p_fingerprint and created_at>now()-interval '1 hour')>=5 then raise exception 'Muitas solicitações. Tente novamente mais tarde.'; end if;
 if (select count(*) from public.crm_intake_requests where created_at>now()-interval '1 hour')>=150 then raise exception 'Muitas solicitações. Tente novamente mais tarde.'; end if;
 select id into target from public.crm_records where kind='stage' and not deleted and data->>'outcome'='open' order by (data->>'position')::numeric,id limit 1;
 if target is null then raise exception 'Captação temporariamente indisponível.'; end if;
 insert into public.crm_records(kind,data) values('deal',p_data||jsonb_build_object('stage_id',target,'value_cents',0,'source','Landing page')) returning id into deal;
 insert into public.crm_intake_requests(request_id,deal_id,fingerprint) values(p_request_id,deal,p_fingerprint);
 return deal;
end $$;
revoke all on function public.crm_validate_record(),public.crm_mutate(uuid,text,jsonb,bigint,boolean),public.crm_undo(uuid),public.crm_intake(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_mutate(uuid,text,jsonb,bigint,boolean),public.crm_undo(uuid) to authenticated;
grant execute on function public.crm_intake(uuid,text,jsonb) to service_role;
insert into public.crm_records(kind,data)
select 'stage',jsonb_build_object('name',name,'color',color,'position',position,'outcome',outcome)
from (values ('Nova oportunidade','#728399',1000,'open'),('Contato realizado','#4a85c6',2000,'open'),('Em qualificação','#9a7cc5',3000,'open'),('Proposta enviada','#c1974c',4000,'open'),('Em negociação','#d18057',5000,'open'),('Oportunidade ganha','#4a967b',6000,'won'),('Oportunidade perdida','#a27379',7000,'lost')) as s(name,color,position,outcome);
