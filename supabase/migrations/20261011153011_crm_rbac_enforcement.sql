-- All existing member-wide SECURITY DEFINER writes move behind role/owner guards.
-- The legacy implementations are private and never executable by API roles.
alter function public.crm_mutate(uuid,text,jsonb,bigint,boolean) rename to crm_mutate_legacy;
alter function public.crm_mutate_legacy(uuid,text,jsonb,bigint,boolean) set schema private;
alter function public.crm_undo(uuid) rename to crm_undo_legacy;
alter function public.crm_undo_legacy(uuid) set schema private;
alter function public.crm_add_note(uuid,text) rename to crm_add_note_legacy;
alter function public.crm_add_note_legacy(uuid,text) set schema private;
alter function public.crm_set_action(uuid,bigint,text,timestamptz,boolean) rename to crm_set_action_legacy;
alter function public.crm_set_action_legacy(uuid,bigint,text,timestamptz,boolean) set schema private;

revoke all on function private.crm_mutate_legacy(uuid,text,jsonb,bigint,boolean),
 private.crm_undo_legacy(uuid),private.crm_add_note_legacy(uuid,text),
 private.crm_set_action_legacy(uuid,bigint,text,timestamptz,boolean)
 from public,anon,authenticated;

create function private.crm_role()
returns text language sql stable security definer set search_path=''
as $$
 select m.role from public.crm_members m
 where m.user_id=auth.uid() and m.status='active'
$$;

create function private.crm_assert_deal(p_id uuid,p_allowed_roles text[])
returns text language plpgsql stable security definer set search_path=''
as $$
declare access_role text; owner_id uuid;
begin
 access_role=private.crm_role();
 if access_role is null or not access_role=any(p_allowed_roles) then
  raise exception 'Acesso não autorizado.' using errcode='42501';
 end if;
 select r.owner_user_id into owner_id from public.crm_records r
 where r.id=p_id and r.kind='deal' and not r.deleted;
 if not found then raise exception 'Oportunidade indisponível.' using errcode='42501'; end if;
 if access_role<>'admin' and owner_id is distinct from auth.uid() then
  raise exception 'Acesso não autorizado.' using errcode='42501';
 end if;
 return access_role;
end $$;

revoke all on function private.crm_role(),private.crm_assert_deal(uuid,text[])
 from public,anon,authenticated;

create function public.crm_mutate(p_id uuid,p_kind text,p_data jsonb,p_revision bigint default 0,p_deleted boolean default false)
returns uuid language plpgsql security definer set search_path=''
as $$
declare access_role text; current_record public.crm_records; operation uuid;
begin
 access_role=private.crm_role();
 if p_kind='stage' then
  if access_role is distinct from 'admin' then
   raise exception 'Acesso não autorizado.' using errcode='42501';
  end if;
 elsif p_kind='deal' then
  if access_role is null or access_role not in ('admin','commercial') then
   raise exception 'Acesso não autorizado.' using errcode='42501';
  end if;
  select * into current_record from public.crm_records where id=p_id;
  if found then
   perform private.crm_assert_deal(p_id,array['admin','commercial']);
  end if;
 else
  raise exception 'Tipo de registro inválido.';
 end if;
 operation=private.crm_mutate_legacy(p_id,p_kind,p_data,p_revision,p_deleted);
 if p_kind='deal' and current_record.id is null and access_role='commercial' then
  update public.crm_records set owner_user_id=auth.uid() where id=p_id;
 end if;
 return operation;
end $$;

create function public.crm_undo(p_operation uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare target public.crm_records; actor_id uuid;
begin
 select r.* into target from public.crm_history h
 join public.crm_records r on r.id=h.record_id where h.id=p_operation;
 select h.actor into actor_id from public.crm_history h where h.id=p_operation;
 if actor_id is distinct from auth.uid() then
  raise exception 'Acesso não autorizado.' using errcode='42501';
 end if;
 if target.kind='stage' then
  if private.crm_role() is distinct from 'admin' then
   raise exception 'Acesso não autorizado.' using errcode='42501';
  end if;
 else
  if coalesce(private.crm_role() not in ('admin','commercial'),true) or
    (private.crm_role()='commercial' and target.owner_user_id is distinct from auth.uid()) then
   raise exception 'Acesso não autorizado.' using errcode='42501';
  end if;
 end if;
 perform private.crm_undo_legacy(p_operation);
end $$;

create function public.crm_add_note(p_deal_id uuid,p_text text)
returns uuid language plpgsql security definer set search_path=''
as $$
begin
 perform private.crm_assert_deal(p_deal_id,array['admin','commercial','support']);
 return private.crm_add_note_legacy(p_deal_id,p_text);
end $$;

create function public.crm_set_action(p_deal_id uuid,p_revision bigint,p_title text,p_due_at timestamptz,p_done boolean)
returns uuid language plpgsql security definer set search_path=''
as $$
begin
 perform private.crm_assert_deal(p_deal_id,array['admin','commercial','support']);
 return private.crm_set_action_legacy(p_deal_id,p_revision,p_title,p_due_at,p_done);
end $$;

create function public.crm_get_events(p_deal_id uuid)
returns table(id uuid,deal_id uuid,event_type text,actor_label text,detail jsonb,created_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
declare access_role text;
begin
 access_role=private.crm_assert_deal(p_deal_id,array['admin','commercial','support','viewer']);
 return query
 select e.id,e.deal_id,e.event_type,e.actor_label,
  case when access_role in ('admin','commercial') then e.detail
       when e.event_type='note' and access_role='support' then jsonb_build_object('text',e.detail->>'text')
       when e.event_type='action_changed' then jsonb_build_object('after',e.detail->'after')
       else '{}'::jsonb end,
  e.created_at
 from public.crm_events e
 where e.deal_id=p_deal_id
   and (access_role in ('admin','commercial') or access_role='support' and e.event_type<>'value_changed');
end $$;

create function public.crm_get_company(p_deal_id uuid)
returns table(profile jsonb)
language plpgsql stable security definer set search_path=''
as $$
declare cnpj text;
begin
 perform private.crm_assert_deal(p_deal_id,array['admin','commercial','support']);
 select r.data->>'company_cnpj' into cnpj from public.crm_records r where r.id=p_deal_id;
 if cnpj is null then return; end if;
 return query select c.profile from public.crm_companies c where c.cnpj=cnpj;
end $$;

create function public.crm_can_enrich(p_deal_id uuid,p_cnpj text)
returns boolean language plpgsql stable security definer set search_path=''
as $$
begin
 perform private.crm_assert_deal(p_deal_id,array['admin','commercial','support']);
 return exists(select 1 from public.crm_records r where r.id=p_deal_id
  and r.data->>'company_cnpj'=p_cnpj);
end $$;

create function public.crm_assign_deal(p_deal_id uuid,p_owner_user_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if private.crm_role() is distinct from 'admin' then
  raise exception 'Acesso não autorizado.' using errcode='42501';
 end if;
 if p_owner_user_id is not null and not exists(
  select 1 from public.crm_members where user_id=p_owner_user_id and status='active'
    and role in ('admin','commercial','support','viewer')
 ) then raise exception 'Responsável inválido.'; end if;
 update public.crm_records set owner_user_id=p_owner_user_id,revision=revision+1,updated_at=now()
 where id=p_deal_id and kind='deal' and not deleted;
 if not found then raise exception 'Oportunidade indisponível.'; end if;
 insert into public.crm_events(deal_id,event_type,actor,actor_label,detail)
 values(p_deal_id,'activity',auth.uid(),coalesce(auth.jwt()->>'email','Administrador ORYNEO'),
  jsonb_build_object('text','Responsável da oportunidade atualizado.'));
end $$;

create function public.crm_list_members()
returns table(user_id uuid,display_name text,directory_email text,role text,status text,created_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
begin
 if private.crm_role() is distinct from 'admin' then
  raise exception 'Acesso não autorizado.' using errcode='42501';
 end if;
 return query select m.user_id,m.display_name,m.directory_email,m.role,m.status,m.created_at
 from public.crm_members m order by m.created_at,m.user_id;
end $$;

create table public.crm_member_audit (
 id uuid primary key default gen_random_uuid(),
 actor uuid not null references auth.users(id),
 member_user_id uuid not null references auth.users(id),
 old_role text not null,old_status text not null,
 new_role text not null,new_status text not null,
 changed_at timestamptz not null default now()
);
alter table public.crm_member_audit enable row level security;
revoke all on public.crm_member_audit from anon,authenticated;

create function public.crm_set_member(p_user_id uuid,p_role text,p_status text,p_display_name text)
returns void language plpgsql security definer set search_path=''
as $$
declare old_role text; old_status text;
begin
 if private.crm_role() is distinct from 'admin' then
  raise exception 'Acesso não autorizado.' using errcode='42501';
 end if;
 if p_role not in ('admin','commercial','support','viewer')
   or p_status not in ('active','suspended') then raise exception 'Permissão inválida.'; end if;
 perform pg_advisory_xact_lock(784916);
 select role,status into old_role,old_status from public.crm_members where user_id=p_user_id for update;
 if not found then raise exception 'Usuário não encontrado.'; end if;
 if old_role='admin' and old_status='active' and (p_role<>'admin' or p_status<>'active')
   and (select count(*) from public.crm_members where role='admin' and status='active')<=1 then
  raise exception 'Mantenha ao menos um administrador ativo.';
 end if;
 update public.crm_members set role=p_role,status=p_status,
  display_name=nullif(left(trim(p_display_name),120),''),updated_at=now()
 where user_id=p_user_id;
 insert into public.crm_member_audit(actor,member_user_id,old_role,old_status,new_role,new_status)
 values(auth.uid(),p_user_id,old_role,old_status,p_role,p_status);
end $$;

revoke all on function public.crm_mutate(uuid,text,jsonb,bigint,boolean),public.crm_undo(uuid),
 public.crm_add_note(uuid,text),public.crm_set_action(uuid,bigint,text,timestamptz,boolean),
 public.crm_get_events(uuid),public.crm_get_company(uuid),public.crm_can_enrich(uuid,text),public.crm_assign_deal(uuid,uuid),
 public.crm_list_members(),public.crm_set_member(uuid,text,text,text)
 from public,anon,authenticated;
grant execute on function public.crm_mutate(uuid,text,jsonb,bigint,boolean),public.crm_undo(uuid),
 public.crm_add_note(uuid,text),public.crm_set_action(uuid,bigint,text,timestamptz,boolean),
 public.crm_get_events(uuid),public.crm_get_company(uuid),public.crm_can_enrich(uuid,text),public.crm_assign_deal(uuid,uuid),
 public.crm_list_members(),public.crm_set_member(uuid,text,text,text)
 to authenticated;

-- Direct table reads remain available for the current frontend until the
-- final lockdown migration is applied after the new frontend is live.
create function private.crm_block_member_add_until_lockdown()
returns trigger language plpgsql set search_path=''
as $$
begin
 raise exception 'Convites temporariamente indisponíveis durante atualização de segurança.';
end $$;
create trigger crm_block_member_add_until_lockdown
before insert on public.crm_members for each row
execute function private.crm_block_member_add_until_lockdown();
