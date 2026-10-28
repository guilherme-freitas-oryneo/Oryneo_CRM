-- Keep the CRM contact current after order issuance and make every billing status transition visible.
create or replace function public.crm_upsert_direct_checkout_draft(
  p_request_id uuid,p_fingerprint text,p_token_hash text,p_deal_data jsonb,p_environment text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_draft public.crm_checkout_drafts%rowtype; v_deal uuid; v_stage uuid; v_profile jsonb; v_cnpj text;
  v_before jsonb; v_patch jsonb;
begin
  if p_request_id is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_token_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_deal_data)<>'object' or p_environment not in ('test','live') then
    raise exception 'Rascunho inválido.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,20261025));
  select * into v_draft from public.crm_checkout_drafts where request_id=p_request_id for update;
  if found then
    if v_draft.public_token_hash<>p_token_hash or v_draft.billing_environment<>p_environment then raise exception 'Solicitação já usada.' using errcode='42501'; end if;
    if v_draft.state='started' then
      update public.crm_records set data=data||p_deal_data||jsonb_build_object(
        'stage_id',data->>'stage_id','source','Checkout iniciado','checkout_origin',case when p_environment='live' then 'direct_live' else 'direct_sandbox' end,
        'checkout_state','started','next_action',jsonb_build_object('title','Retomar contratação','done',false,'updated_at',now())
      ),revision=revision+1 where id=v_draft.deal_id and kind='deal' and not deleted;
    else
      select data into v_before from public.crm_records where id=v_draft.deal_id and kind='deal' and not deleted for update;
      v_patch=jsonb_strip_nulls(jsonb_build_object(
        'contact',nullif(trim(p_deal_data->>'contact'),''),
        'email',nullif(trim(p_deal_data->>'email'),''),
        'phone',nullif(trim(p_deal_data->>'phone'),'')
      ));
      if v_before is not null and v_patch<>'{}'::jsonb and (
        (v_patch ? 'contact' and v_before->>'contact' is distinct from v_patch->>'contact') or
        (v_patch ? 'email' and v_before->>'email' is distinct from v_patch->>'email') or
        (v_patch ? 'phone' and v_before->>'phone' is distinct from v_patch->>'phone')
      ) then
        update public.crm_records set data=data||v_patch,revision=revision+1 where id=v_draft.deal_id;
        if (v_patch ? 'email' and v_before->>'email' is distinct from v_patch->>'email') or
           (v_patch ? 'phone' and v_before->>'phone' is distinct from v_patch->>'phone') then
          insert into public.crm_events(deal_id,event_type,actor_label,detail) values(v_draft.deal_id,'details_changed','Cliente',jsonb_build_object(
            'text','Dados de contato atualizados pelo checkout','before',jsonb_build_object('email',v_before->>'email','phone',v_before->>'phone'),
            'after',jsonb_build_object('email',coalesce(v_patch->>'email',v_before->>'email'),'phone',coalesce(v_patch->>'phone',v_before->>'phone'))
          ));
        end if;
      end if;
    end if;
    update public.crm_checkout_drafts set last_activity_at=now(),updated_at=now() where request_id=p_request_id;
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
    insert into public.crm_checkout_drafts(request_id,deal_id,fingerprint,public_token_hash,billing_environment) values(p_request_id,v_deal,p_fingerprint,p_token_hash,p_environment);
    insert into public.crm_events(deal_id,event_type,actor_label,detail) values(v_deal,'received','Sistema ORYNEO',jsonb_build_object(
      'source','Checkout iniciado','billing_environment',p_environment,'company_cnpj',p_deal_data->>'company_cnpj','plan',p_deal_data->'quote'->>'plan'
    ));
  end if;
  v_cnpj=nullif(p_deal_data->>'company_cnpj','');v_profile=coalesce(p_deal_data->'company_profile','{}'::jsonb);
  if v_cnpj is not null and v_cnpj ~ '^[A-Z0-9]{14}$' and v_profile<>'{}'::jsonb and v_profile<>'null'::jsonb then
    insert into public.crm_companies(cnpj,legal_name,profile,enriched_at) values(v_cnpj,coalesce(nullif(v_profile->>'legal_name',''),p_deal_data->>'company',''),v_profile,now())
    on conflict(cnpj) do update set legal_name=excluded.legal_name,profile=excluded.profile,enriched_at=now(),updated_at=now();
  end if;
  return v_deal;
end $$;
revoke all on function public.crm_upsert_direct_checkout_draft(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.crm_upsert_direct_checkout_draft(uuid,text,text,jsonb,text) to service_role;

create unique index if not exists crm_events_payment_artifact_once
on public.crm_events(deal_id,(detail->>'artifact_key'))
where event_type='activity' and detail ? 'artifact_key';

create or replace function public.crm_record_payment_artifact(p_order_id uuid,p_kind text,p_provider_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.crm_billing_orders%rowtype; v_key text; v_label text; v_inserted integer;
begin
  if p_order_id is null or p_kind not in ('pix_ready','boleto_issued') then raise exception 'Artefato financeiro inválido.' using errcode='22023'; end if;
  if (p_kind='pix_ready' and p_provider_id !~ '^pi_[A-Za-z0-9_]+$') or (p_kind='boleto_issued' and p_provider_id !~ '^in_[A-Za-z0-9_]+$') then raise exception 'Identificador financeiro inválido.' using errcode='22023'; end if;
  select * into v_order from public.crm_billing_orders where id=p_order_id;
  if not found then raise exception 'Pedido não encontrado.' using errcode='P0002'; end if;
  v_key=p_kind||':'||p_provider_id;
  v_label=case p_kind when 'pix_ready' then 'QR Code Pix gerado' else 'Boleto emitido' end;
  insert into public.crm_events(deal_id,event_type,actor_label,detail) values(v_order.deal_id,'activity','Sistema ORYNEO',jsonb_build_object(
    'text',v_label,'artifact_key',v_key,'payment_method',case p_kind when 'pix_ready' then 'pix' else 'boleto' end,'provider_id',p_provider_id,'order_id',v_order.id
  )) on conflict do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=1 then update public.crm_records set revision=revision+1 where id=v_order.deal_id and kind='deal' and not deleted; end if;
  return jsonb_build_object('ok',true,'recorded',v_inserted=1);
end $$;
revoke all on function public.crm_record_payment_artifact(uuid,text,text) from public,anon,authenticated;
grant execute on function public.crm_record_payment_artifact(uuid,text,text) to service_role;

create or replace function public.crm_sync_billing_order_to_deal()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_stage uuid; v_from text; v_changed integer; v_label text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status='paid' then
    select id into v_stage from public.crm_records where kind='stage' and not deleted and data->>'outcome'='won' order by (data->>'position')::numeric,id limit 1;
    if v_stage is null then raise exception 'Etapa de ganho indisponível.'; end if;
    select data->>'stage_id' into v_from from public.crm_records where id=new.deal_id for update;
    update public.crm_records set data=data||jsonb_build_object('stage_id',v_stage,'checkout_state','paid','next_action',jsonb_build_object('title','Iniciar implantação','done',false,'updated_at',now())),revision=revision+1 where id=new.deal_id and kind='deal' and not deleted;
    get diagnostics v_changed=row_count;
    if v_changed=1 and v_from is distinct from v_stage::text then
      insert into public.crm_events(deal_id,event_type,actor_label,detail) values(new.deal_id,'stage_changed','Sistema ORYNEO',jsonb_build_object('from',v_from,'to',v_stage,'reason','Pagamento confirmado','order_id',new.id));
    elsif v_changed=1 then
      insert into public.crm_events(deal_id,event_type,actor_label,detail) values(new.deal_id,'activity','Sistema ORYNEO',jsonb_build_object('text','Pagamento confirmado','order_id',new.id));
    end if;
    update public.crm_checkout_drafts set state='paid',last_activity_at=now(),updated_at=now() where deal_id=new.deal_id;
  elsif new.status in ('payment_failed','expired') then
    v_label=case new.status when 'payment_failed' then 'Pagamento não confirmado' else 'Sessão de pagamento expirada' end;
    update public.crm_records d set data=data||jsonb_build_object('checkout_state',new.status,'next_action',jsonb_build_object('title','Retomar pagamento','done',false,'updated_at',now())),revision=revision+1
    where d.id=new.deal_id and d.kind='deal' and not d.deleted and exists(select 1 from public.crm_records s where s.id=(d.data->>'stage_id')::uuid and s.data->>'outcome'='open');
    get diagnostics v_changed=row_count;
    if v_changed=1 then insert into public.crm_events(deal_id,event_type,actor_label,detail) values(new.deal_id,'activity','Sistema ORYNEO',jsonb_build_object('text',v_label,'order_id',new.id)); end if;
    update public.crm_checkout_drafts set state=new.status,last_activity_at=now(),updated_at=now() where deal_id=new.deal_id and state<>'paid';
  end if;
  return new;
end $$;
revoke all on function public.crm_sync_billing_order_to_deal() from public,anon,authenticated;
drop trigger if exists crm_billing_order_sync_deal on public.crm_billing_orders;
create trigger crm_billing_order_sync_deal after update of status on public.crm_billing_orders for each row execute function public.crm_sync_billing_order_to_deal();

-- Checkout reconciliation changes the order; the trigger above owns CRM stage and timeline updates for every payment method.
create or replace function public.crm_record_stripe_checkout_event(
 p_event_id text,p_event_type text,p_session_id text,p_payment_status text,
 p_customer_id text default null,p_subscription_id text default null,p_invoice_id text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order_id uuid; v_inserted integer;
begin
 if coalesce(p_event_id,'')='' or coalesce(p_session_id,'')='' then raise exception 'Missing event/session id'; end if;
 if p_event_type not in ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed','checkout.session.expired') then return jsonb_build_object('ok',true,'ignored',true); end if;
 select id into v_order_id from public.crm_billing_orders where stripe_checkout_session_id=p_session_id for update;
 if v_order_id is null then return jsonb_build_object('ok',false,'reason','unknown_session'); end if;
 insert into public.crm_stripe_events(event_id,event_type,livemode,payload) values(p_event_id,p_event_type,false,jsonb_build_object('session_id',p_session_id,'payment_status',p_payment_status)) on conflict(event_id) do nothing;
 get diagnostics v_inserted=row_count;
 if p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') and p_payment_status='paid' then
   update public.crm_billing_orders set status='paid',paid_at=coalesce(paid_at,now()),stripe_customer_id=coalesce(p_customer_id,stripe_customer_id),stripe_subscription_id=coalesce(p_subscription_id,stripe_subscription_id),stripe_invoice_id=coalesce(p_invoice_id,stripe_invoice_id),updated_at=now() where id=v_order_id and status<>'refunded';
   if exists(select 1 from public.crm_billing_orders where id=v_order_id and status='paid') then insert into public.crm_billing_welcome(order_id) values(v_order_id) on conflict(order_id) do nothing; end if;
 elsif v_inserted=1 and p_event_type='checkout.session.async_payment_failed' then
   update public.crm_billing_orders set status='payment_failed',updated_at=now() where id=v_order_id and status not in ('paid','refunded','canceled');
 elsif v_inserted=1 and p_event_type='checkout.session.expired' then
   update public.crm_billing_orders set status='expired',updated_at=now() where id=v_order_id and status='awaiting_payment';
 end if;
 return jsonb_build_object('ok',true,'duplicate',v_inserted=0,'order_id',v_order_id);
end $$;
revoke all on function public.crm_record_stripe_checkout_event(text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_record_stripe_checkout_event(text,text,text,text,text,text,text) to service_role;
