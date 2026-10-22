-- Avoid issuing parallel Pix and boleto obligations for one service competence.
do $check$
begin
  if exists (
    select 1
    from public.crm_billing_obligations
    group by order_id,obligation_kind,competence_key,billing_environment
    having count(*)>1
  ) then
    raise exception 'Duplicate billing obligations exist for one competence; reconcile before applying this migration.';
  end if;
end
$check$;

drop index if exists public.crm_billing_obligations_competence_once;
create unique index crm_billing_obligations_competence_once
  on public.crm_billing_obligations(order_id,obligation_kind,competence_key,billing_environment);
