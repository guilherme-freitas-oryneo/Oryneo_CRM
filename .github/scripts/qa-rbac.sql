-- Run only against the disposable database after the RBAC migration.
do $$
declare admin_id uuid := '11111111-1111-4111-8111-111111111111';
begin
  if (select role from public.crm_members where user_id=admin_id) <> 'admin' then
    raise exception 'A conta confirmada não recebeu papel admin';
  end if;
  if (select status from public.crm_members where user_id=admin_id) <> 'active' then
    raise exception 'A conta admin não está ativa';
  end if;
  if exists (
    select 1 from public.crm_records
    where kind='deal' and owner_user_id is not null
  ) then
    raise exception 'Oportunidade histórica ganhou proprietário fictício';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.crm_members'::regclass
      and contype='c' and pg_get_constraintdef(oid) like '%admin%'
  ) then
    raise exception 'Papéis não têm restrição no banco';
  end if;
  begin
    update public.crm_members set role='superuser' where user_id=admin_id;
    raise exception 'Papel arbitrário foi aceito';
  exception when check_violation then null;
  end;
  begin
    update public.crm_records set owner_user_id=admin_id where kind='stage';
    raise exception 'Etapa recebeu proprietário';
  exception when check_violation then null;
  end;
end $$;

-- Um membro não pode editar seu próprio papel/status pela API autenticada.
do $$
begin
  if has_table_privilege('authenticated','public.crm_members','UPDATE') then
    raise exception 'authenticated recebeu UPDATE direto em crm_members';
  end if;
end $$;
