-- Cover the operator foreign key used by audit and support queries.
create index crm_wa_outbox_operator_created
  on public.crm_wa_outbox(operator_id, created_at desc, request_id);
