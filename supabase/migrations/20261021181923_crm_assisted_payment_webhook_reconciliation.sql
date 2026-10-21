create or replace function public.crm_record_assisted_payment_event(
  p_event_id text,
  p_event_type text,
  p_obligation_id uuid,
  p_session_id text,
  p_payment_status text,
  p_amount_cents integer,
  p_currency text,
  p_livemode boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  obligation public.crm_billing_obligations%rowtype;
  inserted integer;
  next_state text;
begin
  if coalesce(p_event_id,'')='' or coalesce(p_session_id,'')='' then
    raise exception 'Evento inválido.' using errcode='22023';
  end if;
  select * into obligation
  from public.crm_billing_obligations
  where id=p_obligation_id and billing_environment=case when p_livemode then 'live' else 'test' end
  for update;
  if not found then return jsonb_build_object('ok',false,'reason','unknown_obligation'); end if;
  if obligation.stripe_checkout_session_id is distinct from p_session_id
     or obligation.amount_total<>p_amount_cents
     or obligation.currency<>p_currency then
    return jsonb_build_object('ok',false,'reason','mismatch');
  end if;
  insert into public.crm_stripe_events(event_id,event_type,livemode,payload)
  values(p_event_id,p_event_type,p_livemode,jsonb_build_object('obligation_id',obligation.id,'session_id',p_session_id,'payment_status',p_payment_status))
  on conflict(event_id) do nothing;
  get diagnostics inserted=row_count;
  if inserted=0 or obligation.state='paid' then
    return jsonb_build_object('ok',true,'duplicate',inserted=0,'outcome','ignored');
  end if;
  next_state:=case
    when p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') and p_payment_status='paid' then 'paid'
    when p_event_type in ('checkout.session.completed','checkout.session.async_payment_succeeded') then 'processing'
    when p_event_type='checkout.session.async_payment_failed' then 'failed'
    when p_event_type='checkout.session.expired' then 'expired'
    else null
  end;
  if next_state is null then return jsonb_build_object('ok',true,'outcome','ignored'); end if;
  update public.crm_billing_obligations
  set state=next_state,
      paid_at=case when next_state='paid' then coalesce(paid_at,clock_timestamp()) else paid_at end,
      updated_at=clock_timestamp()
  where id=obligation.id;
  if next_state='paid' then
    update public.crm_automation_jobs
    set state='cancelled',completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where subject_type='billing_obligation' and subject_id=obligation.id
      and state in ('scheduled','failed','reconciliation');
  end if;
  return jsonb_build_object('ok',true,'duplicate',false,'outcome',next_state);
end
$function$;

revoke all on function public.crm_record_assisted_payment_event(text,text,uuid,text,text,integer,text,boolean)
  from public,anon,authenticated;
grant execute on function public.crm_record_assisted_payment_event(text,text,uuid,text,text,integer,text,boolean)
  to service_role;
