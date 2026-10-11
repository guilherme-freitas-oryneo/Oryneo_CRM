-- New Brazilian alphanumeric CNPJ support, preserving numeric CNPJ.
alter table public.crm_companies drop constraint if exists crm_companies_cnpj_check;
alter table public.crm_companies add constraint crm_companies_cnpj_check check(cnpj ~ '^[A-Z0-9]{14}$');
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
  if company_cnpj !~ '^[A-Z0-9]{14} then raise exception 'CNPJ inválido.'; end if;
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

 then raise exception 'CNPJ inválido.'; end if;
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

