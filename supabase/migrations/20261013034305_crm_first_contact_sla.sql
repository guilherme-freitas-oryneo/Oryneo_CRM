-- ORYNEO first-contact pipeline, SLA and idempotent audit record.
create or replace function public.crm_business_due(p_from timestamptz,p_rule text)
returns timestamptz
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_local timestamp;
  v_date date;
  v_due_local timestamp;
  v_dow integer;
  v_time time;
begin
  if p_from is null or p_rule not in ('initial_two_hours','next_weekday') then
    raise exception 'Regra de prazo inválida.' using errcode='22023';
  end if;
  v_local := p_from at time zone 'America/Sao_Paulo';
  v_dow := extract(isodow from v_local)::integer;
  v_time := v_local::time;

  if p_rule='initial_two_hours' then
    if v_dow between 1 and 5 and v_time between time '08:00:00' and time '16:00:00' then
      v_due_local := v_local + interval '2 hours';
    elsif v_dow between 1 and 5 and v_time < time '08:00:00' then
      v_due_local := v_local::date + time '10:00:00';
    else
      v_date := v_local::date;
      if v_dow between 1 and 5 then v_date := v_date + 1; end if;
      while extract(isodow from v_date)::integer > 5 loop v_date := v_date + 1; end loop;
      v_due_local := v_date + time '10:00:00';
    end if;
  else
    v_date := v_local::date + 1;
    while extract(isodow from v_date)::integer > 5 loop v_date := v_date + 1; end loop;
    v_due_local := v_date + v_time;
  end if;
  return v_due_local at time zone 'America/Sao_Paulo';
end
$$;

do $$
declare v_count integer;
begin
  update public.crm_records r
  set data=jsonb_set(r.data,'{name}',to_jsonb(s.name),true),revision=r.revision+1
  from (values
    ('87f1e31e-3912-40b0-9284-c6805c84dafe'::uuid,'Diagnóstico pendente'::text),
    ('621dfba1-d185-4732-96a0-afefe603ad65'::uuid,'Diagnóstico agendado'::text),
    ('8e200e46-92db-4419-b752-11ab089fd5a3'::uuid,'Qualificada'::text),
    ('e980564c-5249-47b4-9c22-671b98f24550'::uuid,'Proposta enviada'::text),
    ('f883a26d-d813-4d09-b807-fa1eb44396f4'::uuid,'Em decisão'::text),
    ('6ab321bd-5ec4-4dfc-b8c0-4824da854273'::uuid,'Ganha'::text),
    ('2f0e27bf-cc1f-4656-9905-170fbc45b25c'::uuid,'Perdida'::text)
  ) as s(id,name)
  where r.id=s.id and r.kind='stage' and not r.deleted;
  get diagnostics v_count=row_count;
  if v_count<>7 then raise exception 'Pipeline ORYNEO divergente; migração interrompida.'; end if;
end
$$;

alter table public.crm_events drop constraint if exists crm_events_event_type_check;
alter table public.crm_events add constraint crm_events_event_type_check check(event_type in (
  'received','stage_changed','value_changed','note','activity','action_changed','reconciled','details_changed','email_sent'
));
create unique index if not exists crm_events_email_idempotency
on public.crm_events(deal_id,(detail->>'idempotency_key')) where event_type='email_sent';

create or replace function public.crm_intake(p_request_id uuid,p_fingerprint text,p_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; deal uuid; company_cnpj text; profile jsonb; due_at timestamptz;
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
  if company_cnpj !~ '^[A-Z0-9]{14}$' then raise exception 'CNPJ inválido.'; end if;
  insert into public.crm_companies(cnpj,legal_name,profile,enriched_at) values(company_cnpj,coalesce(p_data->>'company',''),profile,case when profile<>'{}'::jsonb then now() else null end)
  on conflict(cnpj) do update set
    legal_name=coalesce(nullif(excluded.legal_name,''),public.crm_companies.legal_name),
    profile=case when excluded.profile<>'{}'::jsonb then excluded.profile else public.crm_companies.profile end,
    enriched_at=case when excluded.profile<>'{}'::jsonb then now() else public.crm_companies.enriched_at end,
    updated_at=now();
 end if;
 due_at=public.crm_business_due(now(),'initial_two_hours');
 insert into public.crm_records(kind,data) values('deal',p_data||
 jsonb_build_object('stage_id',target,'value_cents',coalesce((p_data->>'value_cents')::bigint,0),'source','Landing page','next_action',jsonb_build_object('title','Realizar primeiro contato','done',false,'due_at',due_at,'updated_at',now())))
 returning id into deal;
 insert into public.crm_intake_requests(request_id,deal_id,fingerprint) values(p_request_id,deal,p_fingerprint);
 insert into public.crm_events(deal_id,event_type,actor_label,detail)
 values(deal,'received','Sistema ORYNEO',jsonb_build_object('source','Landing page','company_cnpj',company_cnpj,'value_cents',coalesce((p_data->>'value_cents')::bigint,0),'plan',p_data->'quote'->>'plan'));
 return deal;
end $$;

create or replace function public.crm_record_first_contact(p_deal_id uuid,p_idempotency_key uuid,p_internet_message_id text,p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_deal public.crm_records;
  v_existing public.crm_events;
  v_sent_at timestamptz;
  v_first_contact jsonb;
  v_next_action jsonb;
  v_actor_label text;
  v_is_resend boolean;
begin
  if p_deal_id is null or p_idempotency_key is null or p_actor is null then
    raise exception 'Registro de contato inválido.' using errcode='22023';
  end if;
  if p_internet_message_id is null or length(p_internet_message_id) not between 1 and 998 or p_internet_message_id ~ E'[\\r\\n]' then
    raise exception 'Identificador de mensagem inválido.' using errcode='22023';
  end if;
  if not exists(select 1 from public.crm_members where user_id=p_actor) then
    raise exception 'Responsável sem acesso ao CRM.' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(784915);
  select * into v_existing from public.crm_events
  where deal_id=p_deal_id and event_type='email_sent' and detail->>'idempotency_key'=p_idempotency_key::text;
  if found then
    if v_existing.detail->>'internet_message_id' is distinct from p_internet_message_id then
      raise exception 'Chave de envio já utilizada.' using errcode='22023';
    end if;
    return jsonb_build_object(
      'already_recorded',true,
      'sent_at',coalesce(v_existing.detail->>'sent_at',v_existing.created_at::text),
      'internet_message_id',v_existing.detail->>'internet_message_id',
      'idempotency_key',p_idempotency_key
    );
  end if;

  select * into v_deal from public.crm_records where id=p_deal_id and kind='deal' and not deleted for update;
  if not found then raise exception 'Oportunidade não encontrada.' using errcode='P0002'; end if;

  v_sent_at=clock_timestamp();
  v_is_resend=jsonb_typeof(v_deal.data->'first_contact')='object';
  v_first_contact=case when v_is_resend then v_deal.data->'first_contact' else jsonb_build_object(
    'sent_at',v_sent_at,'internet_message_id',p_internet_message_id,'idempotency_key',p_idempotency_key
  ) end;
  v_next_action=jsonb_build_object(
    'title','Acompanhar resposta do diagnóstico',
    'due_at',public.crm_business_due(v_sent_at,'next_weekday'),
    'done',false,
    'updated_at',v_sent_at
  );
  update public.crm_records
  set data=jsonb_set(jsonb_set(data,'{first_contact}',v_first_contact,true),'{next_action}',v_next_action,true),revision=revision+1
  where id=p_deal_id;

  select coalesce(nullif(email,''),'Usuário ORYNEO') into v_actor_label from auth.users where id=p_actor;
  insert into public.crm_events(deal_id,event_type,actor,actor_label,detail)
  values(p_deal_id,'email_sent',p_actor,coalesce(v_actor_label,'Usuário ORYNEO'),jsonb_build_object(
    'idempotency_key',p_idempotency_key,
    'internet_message_id',p_internet_message_id,
    'sent_at',v_sent_at,
    'resend',v_is_resend
  ));
  return jsonb_build_object(
    'already_recorded',false,
    'sent_at',v_sent_at,
    'internet_message_id',p_internet_message_id,
    'idempotency_key',p_idempotency_key
  );
end
$$;

revoke all on function public.crm_business_due(timestamptz,text),public.crm_record_first_contact(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.crm_business_due(timestamptz,text),public.crm_record_first_contact(uuid,uuid,text,uuid) to service_role;
