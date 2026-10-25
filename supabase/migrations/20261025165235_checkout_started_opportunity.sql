-- One direct-checkout browser journey maps to one CRM opportunity from the first meaningful field.
create table public.crm_checkout_drafts (
  request_id uuid primary key,
  deal_id uuid not null unique references public.crm_records(id) on delete restrict,
  order_id uuid unique references public.crm_billing_orders(id) on delete restrict,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  public_token_hash text not null unique check (public_token_hash ~ '^[a-f0-9]{64}$'),
  billing_environment text not null check (billing_environment in ('test','live')),
  state text not null default 'started' check (state in ('started','checkout_created','paid','payment_failed','expired')),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_checkout_drafts_fingerprint_created on public.crm_checkout_drafts(fingerprint,created_at desc);
create index crm_checkout_drafts_activity on public.crm_checkout_drafts(state,last_activity_at desc);
alter table public.crm_checkout_drafts enable row level security;
revoke all on public.crm_checkout_drafts from public,anon,authenticated;

create or replace function public.crm_upsert_direct_checkout_draft(
  p_request_id uuid,p_fingerprint text,p_token_hash text,p_deal_data jsonb,p_environment text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_draft public.crm_checkout_drafts%rowtype; v_deal uuid; v_stage uuid; v_profile jsonb; v_cnpj text;
begin
  if p_request_id is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_token_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_deal_data) <> 'object' or p_environment not in ('test','live') then
    raise exception 'Rascunho inválido.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,20261025));
  select * into v_draft from public.crm_checkout_drafts where request_id=p_request_id for update;
  if found then
    if v_draft.public_token_hash<>p_token_hash or v_draft.billing_environment<>p_environment then
      raise exception 'Solicitação já usada.' using errcode='42501';
    end if;
    if v_draft.state='started' then
      update public.crm_records set data=data||p_deal_data||jsonb_build_object(
        'stage_id',data->>'stage_id','source','Checkout iniciado','checkout_origin',case when p_environment='live' then 'direct_live' else 'direct_sandbox' end,
        'checkout_state','started','next_action',jsonb_build_object('title','Retomar contratação','done',false,'updated_at',now())
      ),revision=revision+1 where id=v_draft.deal_id and kind='deal' and not deleted;
      update public.crm_checkout_drafts set last_activity_at=now(),updated_at=now() where request_id=p_request_id;
    end if;
    v_deal=v_draft.deal_id;
  else
    if (select count(*) from public.crm_checkout_drafts where fingerprint=p_fingerprint and created_at>now()-interval '1 hour')>=8
      or (select count(*) from public.crm_checkout_drafts where created_at>now()-interval '1 hour')>=500 then
      raise exception 'Muitas solicitações. Tente novamente mais tarde.' using errcode='54000';
    end if;
    select id into v_stage from public.crm_records where kind='stage' and not deleted and data->>'outcome'='open' order by (data->>'position')::numeric,id limit 1;
    if v_stage is null then raise exception 'Captação temporariamente indisponível.'; end if;
    insert into public.crm_records(kind,data) values('deal',p_deal_data||jsonb_build_object(
      'stage_id',v_stage,'source','Checkout iniciado','checkout_origin',case when p_environment='live' then 'direct_live' else 'direct_sandbox' end,
      'checkout_state','started','next_action',jsonb_build_object('title','Retomar contratação','done',false,'updated_at',now())
    )) returning id into v_deal;
    insert into public.crm_checkout_drafts(request_id,deal_id,fingerprint,public_token_hash,billing_environment)
      values(p_request_id,v_deal,p_fingerprint,p_token_hash,p_environment);
    insert into public.crm_events(deal_id,event_type,actor_label,detail) values(v_deal,'received','Sistema ORYNEO',jsonb_build_object(
      'source','Checkout iniciado','billing_environment',p_environment,'company_cnpj',p_deal_data->>'company_cnpj','plan',p_deal_data->'quote'->>'plan'
    ));
  end if;
  v_cnpj=nullif(p_deal_data->>'company_cnpj',''); v_profile=coalesce(p_deal_data->'company_profile','{}'::jsonb);
  if v_cnpj is not null and v_cnpj ~ '^[A-Z0-9]{14}$' and v_profile<>'{}'::jsonb and v_profile<>'null'::jsonb then
    insert into public.crm_companies(cnpj,legal_name,profile,enriched_at) values(v_cnpj,coalesce(nullif(v_profile->>'legal_name',''),p_deal_data->>'company',''),v_profile,now())
    on conflict(cnpj) do update set legal_name=excluded.legal_name,profile=excluded.profile,enriched_at=now(),updated_at=now();
  end if;
  return v_deal;
end $$;
revoke all on function public.crm_upsert_direct_checkout_draft(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.crm_upsert_direct_checkout_draft(uuid,text,text,jsonb,text) to service_role;

create or replace function public.crm_create_direct_checkout(
  p_request_id uuid,p_fingerprint text,p_token_hash text,p_deal_data jsonb,p_order jsonb,p_environment text
) returns table(order_id uuid,reference text,stripe_checkout_session_id text)
language plpgsql security definer set search_path='' as $$
declare v_draft public.crm_checkout_drafts%rowtype; v_deal uuid; v_member uuid; v_order uuid; v_profile jsonb; v_cnpj text;
begin
  if p_request_id is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_token_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_deal_data)<>'object' or jsonb_typeof(p_order)<>'object' or p_environment not in ('test','live') then
    raise exception 'Pedido direto inválido.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,20261025));
  select * into v_draft from public.crm_checkout_drafts where request_id=p_request_id for update;
  if not found then
    v_deal=public.crm_upsert_direct_checkout_draft(p_request_id,p_fingerprint,p_token_hash,p_deal_data,p_environment);
    select * into v_draft from public.crm_checkout_drafts where request_id=p_request_id for update;
  else
    if v_draft.public_token_hash<>p_token_hash or v_draft.billing_environment<>p_environment then raise exception 'Solicitação já usada.' using errcode='42501'; end if;
    v_deal=v_draft.deal_id;
  end if;
  if v_draft.order_id is not null then
    return query select o.id,o.reference,o.stripe_checkout_session_id from public.crm_billing_orders o where o.id=v_draft.order_id and o.public_token_hash=p_token_hash and o.billing_environment=p_environment;
    if not found then raise exception 'Solicitação já usada.' using errcode='42501'; end if;
    return;
  end if;
  select user_id into v_member from public.crm_members order by user_id limit 1;
  if v_member is null then raise exception 'Operação indisponível.'; end if;
  update public.crm_records set data=data||p_deal_data||jsonb_build_object(
    'stage_id',data->>'stage_id','source',case when p_environment='live' then 'Checkout direto' else 'Checkout direto (sandbox)' end,
    'checkout_origin',case when p_environment='live' then 'direct_live' else 'direct_sandbox' end,'checkout_state','payment_pending',
    'next_action',jsonb_build_object('title',case when p_environment='live' then 'Acompanhar pagamento' else 'Acompanhar pagamento sandbox' end,'done',false,'updated_at',now())
  ),revision=revision+1 where id=v_deal and kind='deal' and not deleted;
  if not found then raise exception 'Oportunidade indisponível.'; end if;
  v_cnpj=nullif(p_deal_data->>'company_cnpj',''); v_profile=coalesce(p_deal_data->'company_profile','{}'::jsonb);
  if v_cnpj is not null and v_cnpj ~ '^[A-Z0-9]{14}$' and v_profile<>'{}'::jsonb and v_profile<>'null'::jsonb then
    insert into public.crm_companies(cnpj,legal_name,profile,enriched_at) values(v_cnpj,coalesce(nullif(v_profile->>'legal_name',''),p_deal_data->>'company',''),v_profile,now())
    on conflict(cnpj) do update set legal_name=excluded.legal_name,profile=excluded.profile,enriched_at=now(),updated_at=now();
  end if;
  insert into public.crm_billing_orders(deal_id,reference,public_token_hash,status,catalog_version,billing_environment,stripe_traffic_renewal_price_id,selection,items,amount_total,customer_name,customer_email,company,created_by)
  values(v_deal,p_order->>'reference',p_token_hash,'awaiting_payment',p_order->>'catalog_version',p_environment,nullif(p_order->>'traffic_renewal_price_id',''),p_order->'selection',p_order->'items',(p_order->>'amount_total')::integer,p_order->>'customer_name',p_order->>'customer_email',p_order->>'company',v_member) returning id into v_order;
  update public.crm_checkout_drafts set order_id=v_order,state='checkout_created',last_activity_at=now(),updated_at=now() where request_id=p_request_id;
  insert into public.crm_events(deal_id,event_type,actor_label,detail) values(v_deal,'activity','Sistema ORYNEO',jsonb_build_object('text','Pagamento preparado','order_id',v_order,'billing_environment',p_environment));
  return query select o.id,o.reference,o.stripe_checkout_session_id from public.crm_billing_orders o where o.id=v_order;
end $$;
revoke all on function public.crm_create_direct_checkout(uuid,text,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.crm_create_direct_checkout(uuid,text,text,jsonb,jsonb,text) to service_role;

create or replace function public.crm_record_stripe_checkout_event(
 p_event_id text,p_event_type text,p_session_id text,p_payment_status text,
 p_customer_id text default null,p_subscription_id text default null,p_invoice_id text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order_id uuid; v_deal_id uuid; v_inserted integer; v_won_stage uuid; v_from_stage text;
begin
 if coalesce(p_event_id,'')='' or coalesce(p_session_id,'')='' then raise exception 'Missing event/session id'; end if;
 if p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired') then return jsonb_build_object('ok',true,'ignored',true); end if;
 select id,deal_id into v_order_id,v_deal_id from public.crm_billing_orders where stripe_checkout_session_id=p_session_id for update;
 if v_order_id is null then return jsonb_build_object('ok',false,'reason','unknown_session'); end if;
 insert into public.crm_stripe_events(event_id,event_type,livemode,payload) values(p_event_id,p_event_type,false,jsonb_build_object('session_id',p_session_id,'payment_status',p_payment_status)) on conflict(event_id) do nothing;
 get diagnostics v_inserted=row_count;
 if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') and p_payment_status='paid' then
   update public.crm_billing_orders set status='paid',paid_at=coalesce(paid_at,now()),stripe_customer_id=coalesce(p_customer_id,stripe_customer_id),stripe_subscription_id=coalesce(p_subscription_id,stripe_subscription_id),stripe_invoice_id=coalesce(p_invoice_id,stripe_invoice_id),updated_at=now() where id=v_order_id and status<>'refunded';
   if exists(select 1 from public.crm_billing_orders where id=v_order_id and status='paid') then
     insert into public.crm_billing_welcome(order_id) values(v_order_id) on conflict(order_id) do nothing;
     select id into v_won_stage from public.crm_records where kind='stage' and not deleted and data->>'outcome'='won' order by (data->>'position')::numeric,id limit 1;
     if v_won_stage is null then raise exception 'Etapa de ganho indisponível.'; end if;
     select data->>'stage_id' into v_from_stage from public.crm_records where id=v_deal_id for update;
     update public.crm_records set data=data||jsonb_build_object('stage_id',v_won_stage,'checkout_state','paid','next_action',jsonb_build_object('title','Iniciar implantação','done',false,'updated_at',now())),revision=revision+1 where id=v_deal_id and kind='deal' and not deleted and data->>'stage_id' is distinct from v_won_stage::text;
     if found then insert into public.crm_events(deal_id,event_type,actor_label,detail) values(v_deal_id,'stage_changed','Sistema ORYNEO',jsonb_build_object('from',v_from_stage,'to',v_won_stage,'reason','Pagamento confirmado','order_id',v_order_id)); end if;
     update public.crm_checkout_drafts set state='paid',last_activity_at=now(),updated_at=now() where deal_id=v_deal_id;
   end if;
 elsif v_inserted=1 and p_event_type='checkout.session.async_payment_failed' then
   update public.crm_billing_orders set status='payment_failed',updated_at=now() where id=v_order_id and status not in ('paid','refunded','canceled');
   update public.crm_records d set data=data||jsonb_build_object('checkout_state','payment_failed','next_action',jsonb_build_object('title','Retomar pagamento','done',false,'updated_at',now())),revision=revision+1 where d.id=v_deal_id and d.kind='deal' and not d.deleted and exists(select 1 from public.crm_records s where s.id=(d.data->>'stage_id')::uuid and s.data->>'outcome'='open');
   update public.crm_checkout_drafts set state='payment_failed',last_activity_at=now(),updated_at=now() where deal_id=v_deal_id and state<>'paid';
   insert into public.crm_events(deal_id,event_type,actor_label,detail) values(v_deal_id,'activity','Sistema ORYNEO',jsonb_build_object('text','Pagamento não confirmado','order_id',v_order_id));
 elsif v_inserted=1 and p_event_type='checkout.session.expired' then
   update public.crm_billing_orders set status='expired',updated_at=now() where id=v_order_id and status='awaiting_payment';
   update public.crm_records d set data=data||jsonb_build_object('checkout_state','expired','next_action',jsonb_build_object('title','Retomar pagamento','done',false,'updated_at',now())),revision=revision+1 where d.id=v_deal_id and d.kind='deal' and not d.deleted and exists(select 1 from public.crm_records s where s.id=(d.data->>'stage_id')::uuid and s.data->>'outcome'='open');
   update public.crm_checkout_drafts set state='expired',last_activity_at=now(),updated_at=now() where deal_id=v_deal_id and state<>'paid';
   insert into public.crm_events(deal_id,event_type,actor_label,detail) values(v_deal_id,'activity','Sistema ORYNEO',jsonb_build_object('text','Sessão de pagamento expirada','order_id',v_order_id));
 end if;
 return jsonb_build_object('ok',true,'duplicate',v_inserted=0,'order_id',v_order_id);
end $$;
revoke all on function public.crm_record_stripe_checkout_event(text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_record_stripe_checkout_event(text,text,text,text,text,text,text) to service_role;
