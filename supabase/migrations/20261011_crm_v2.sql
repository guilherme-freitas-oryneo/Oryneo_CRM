
-- ORYNEO CRM v2: append-only commercial timeline, reusable company profile,
-- lead quotes, and next-action workflow. Backward compatible with existing records.
create table if not exists public.crm_companies (
 cnpj text primary key check (cnpj ~ '^[0-9]{14}$'),
 legal_name text not null default '',
 profile jsonb not null default '{}'::jsonb,
 enriched_at timestamptz,
 updated_at timestamptz not null default now()
);
create table if not exists public.crm_events (
 id uuid primary key default gen_random_uuid(),
 deal_id uuid not null references public.crm_records(id) on delete restrict,
 event_type text not null check(event_type in ('received','stage_changed','value_changed','note','activity','action_changed','reconciled','details_changed')),
 actor uuid references auth.users(id) on delete set null,
 actor_label text not null default 'Sistema ORYNEO',
 detail jsonb not null default '{}'::jsonb check(jsonb_typeof(detail)='object'),
 created_at timestamptz not null default now()
);
create index if not exists crm_events_deal_time on public.crm_events(deal_id,created_at desc,id desc);
create index if not exists crm_companies_name on public.crm_companies(legal_name);
alter table public.crm_companies enable row level security;
alter table public.crm_events enable row level security;
revoke all on public.crm_companies,public.crm_events from anon,authenticated;
grant select on public.crm_companies,public.crm_events to authenticated;
create policy crm_companies_members_read on public.crm_companies
 for select to authenticated using(exists(select 1 from public.crm_members where user_id=(select auth.uid())));
create policy crm_events_members_read on public.crm_events
 for select to authenticated using(exists(select 1 from public.crm_members where user_id=(select auth.uid())));

create or replace function public.crm_add_note(p_deal_id uuid,p_text text)
returns uuid language plpgsql security definer set search_path='' as $$
declare eid uuid; who text;
begin
 if not exists(select 1 from public.crm_members where user_id=auth.uid()) then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 if p_text is null or length(trim(p_text)) not between 1 and 3000 then raise exception 'Nota inválida.'; end if;
 if not exists(select 1 from public.crm_records where id=p_deal_id and kind='deal' and not deleted) then raise exception 'Oportunidade não encontrada.'; end if;
 who=coalesce(nullif(auth.jwt()->>'email',''),'Usuário ORYNEO');
 insert into public.crm_events(deal_id,event_type,actor,actor_label,detail)
 values(p_deal_id,'note',auth.uid(),who,jsonb_build_object('text',trim(p_text))) returning id into eid;
 return eid;
end $$;

create or replace function public.crm_set_action(p_deal_id uuid,p_revision bigint,p_title text,p_due_at timestamptz,p_done boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.crm_records; eid uuid; who text; next_action jsonb;
begin
 if not exists(select 1 from public.crm_members where user_id=auth.uid()) then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 if p_title is null or length(trim(p_title)) not between 1 and 160 then raise exception 'Próxima ação inválida.'; end if;
 perform pg_advisory_xact_lock(784915);
 select * into previous from public.crm_records where id=p_deal_id and kind='deal' and not deleted for update;
 if not found or previous.revision<>p_revision then raise exception 'Oportunidade atualizada em outra sessão. Recarregue a ficha.'; end if;
 next_action=jsonb_build_object('title',trim(p_title),'due_at',p_due_at,'done',coalesce(p_done,false),'updated_at',now());
 update public.crm_records set data=jsonb_set(data,'{next_action}',next_action),revision=revision+1 where id=p_deal_id;
 who=coalesce(nullif(auth.jwt()->>'email',''),'Usuário ORYNEO');
 insert into public.crm_events(deal_id,event_type,actor,actor_label,detail)
 values(p_deal_id,'action_changed',auth.uid(),who,jsonb_build_object('before',coalesce(previous.data->'next_action','null'::jsonb),'after',next_action)) returning id into eid;
 return eid;
end $$;

-- Preserve crm_mutate's serialized revision-based writes and undo log while
-- separately recording meaningful updates for the shared commercial timeline.
create or replace function public.crm_mutate(p_id uuid,p_kind text,p_data jsonb,p_revision bigint default 0,p_deleted boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare previous public.crm_records; result public.crm_records; operation uuid; who text;
begin
 if not exists(select 1 from public.crm_members where user_id=auth.uid()) then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(784915);
 select * into previous from public.crm_records where id=p_id for update;
 if found then
  if previous.revision<>p_revision or previous.kind<>p_kind then raise exception 'Este registro foi atualizado. Recarregue e tente novamente.'; end if;
  update public.crm_records set data=p_data,deleted=p_deleted,revision=revision+1 where id=p_id returning * into result;
 else
  if p_revision<>0 or p_deleted then raise exception 'Registro indisponível.'; end if;
  insert into public.crm_records(id,kind,data) values(p_id,p_kind,p_data) returning * into result;
 end if;
 insert into public.crm_history(actor,record_id,before_data,before_deleted,after_revision) values(auth.uid(),p_id,previous.data,previous.deleted,result.revision) returning id into operation;
 if p_kind='deal' then
  who=coalesce(nullif(auth.jwt()->>'email',''),'Usuário ORYNEO');
  if not found then null; end if;
  if previous.id is null then
    insert into public.crm_events(deal_id,event_type,actor,actor_label,detail)
    values(p_id,'received',auth.uid(),who,jsonb_build_object('source','Manual'));
  elsif previous.data->>'stage_id' is distinct from p_data->>'stage_id' then
    insert into public.crm_events(deal_id,event_type,actor,actor_label,detail)
    values(p_id,'stage_changed',auth.uid(),who,jsonb_build_object('from',previous.data->>'stage_id','to',p_data->>'stage_id'));
  end if;
  if previous.id is not null and previous.data->>'value_cents' is distinct from p_data->>'value_cents' then
    insert into public.crm_events(deal_id,event_type,actor,actor_label,detail)
    values(p_id,'value_changed',auth.uid(),who,jsonb_build_object('from',previous.data->>'value_cents','to',p_data->>'value_cents'));
  end if;
 end if;
 return operation;
end $$;

-- New intake trusts pricing only when server has normalized the quote.
-- The request_id unique constraint preserves replay idempotency.
create or replace function public.crm_intake(p_request_id uuid,p_fingerprint text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; deal uuid; company_cnpj text; profile jsonb;
begin
 perform pg_advisory_xact_lock(784915);
 select deal_id into deal from public.crm_intake_requests where request_id=p_request_id;
 if found then return deal; end if;
 if (select count(*) from public.crm_intake_requests where fingerprint=p_fingerprint and created_at>now()-interval '1 hour')>=5 then raise exception 'Muitas solicitações. Tente novamente mais tarde.'; end if;
 if (select count(*) from public.crm_intake_requests where created_at>now()-interval '1 hour')>=150 then raise exception 'Muitas solicitações. Tente novamente mais tarde.'; end if;
 select id into target from public.crm_records where kind='stage' and not deleted and data->>'outcome'='open' order by (data->>'position')::numeric,id limit 1;
 if target is null then raise exception 'Captação temporariamente indisponível.'; end if;
 company_cnpj=nullif(p_data->>'company_cnpj','');
 profile=coalesce(p_data->'company_profile','{}'::jsonb);
 if company_cnpj is not null then
  if company_cnpj !~ '^[0-9]{14}$' then raise exception 'CNPJ inválido.'; end if;
  insert into public.crm_companies(cnpj,legal_name,profile,enriched_at) values(company_cnpj,coalesce(p_data->>'company',''),profile,case when profile<>'{}'::jsonb then now() else null end)
  on conflict(cnpj) do update set
    legal_name=coalesce(nullif(excluded.legal_name,''),public.crm_companies.legal_name),
    profile=case when excluded.profile<>'{}'::jsonb then excluded.profile else public.crm_companies.profile end,
    enriched_at=case when excluded.profile<>'{}'::jsonb then now() else public.crm_companies.enriched_at end,
    updated_at=now();
 end if;
 insert into public.crm_records(kind,data) values('deal',p_data||
 jsonb_build_object('stage_id',target,'value_cents',coalesce((p_data->>'value_cents')::bigint,0),'source','Landing page','next_action',jsonb_build_object('title','Realizar diagnóstico inicial','done',false,'due_at',null)))
 returning id into deal;
 insert into public.crm_intake_requests(request_id,deal_id,fingerprint) values(p_request_id,deal,p_fingerprint);
 insert into public.crm_events(deal_id,event_type,actor_label,detail)
 values(deal,'received','Sistema ORYNEO',jsonb_build_object('source','Landing page','company_cnpj',company_cnpj,'value_cents',coalesce((p_data->>'value_cents')::bigint,0),'plan',p_data->'quote'->>'plan'));
 return deal;
end $$;

revoke all on function public.crm_add_note(uuid,text),public.crm_set_action(uuid,bigint,text,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.crm_add_note(uuid,text),public.crm_set_action(uuid,bigint,text,timestamptz,boolean) to authenticated;
-- Existing mutate/intake grants stay restricted as before.
