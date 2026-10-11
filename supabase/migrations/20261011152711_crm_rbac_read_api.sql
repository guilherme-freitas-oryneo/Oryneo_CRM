-- Additive API for a staged rollout. Direct table reads are revoked only
-- after every frontend read has moved to scoped APIs.
create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated;

create function private.crm_get_board()
returns table(
  id uuid,
  kind text,
  data jsonb,
  revision bigint,
  deleted boolean,
  created_at timestamptz,
  updated_at timestamptz,
  owner_user_id uuid
)
language plpgsql stable security definer set search_path=''
as $$
declare
  viewer_id uuid := auth.uid();
  access_role text;
begin
  select m.role into access_role
  from public.crm_members m
  where m.user_id=viewer_id and m.status='active';

  if access_role is null then
    raise exception 'Acesso não autorizado.' using errcode='42501';
  end if;

  return query
  select r.id,r.kind,
    case
      when r.kind='stage' or access_role in ('admin','commercial') then r.data
      when access_role='support' then jsonb_strip_nulls(jsonb_build_object(
        'title',r.data->'title',
        'company',r.data->'company',
        'contact',r.data->'contact',
        'email',r.data->'email',
        'phone',r.data->'phone',
        'stage_id',r.data->'stage_id',
        'source',r.data->'source',
        'due_date',r.data->'due_date',
        'next_action',r.data->'next_action'
      ))
      else jsonb_strip_nulls(jsonb_build_object(
        'title',r.data->'title',
        'company',r.data->'company',
        'stage_id',r.data->'stage_id',
        'source',r.data->'source'
      ))
    end as data,
    r.revision,r.deleted,r.created_at,r.updated_at,r.owner_user_id
  from public.crm_records r
  where not r.deleted
    and (r.kind='stage' or access_role='admin' or r.owner_user_id=viewer_id);
end $$;

revoke all on function private.crm_get_board() from public,anon,authenticated;
grant execute on function private.crm_get_board() to authenticated;

create function public.crm_get_board()
returns table(
  id uuid,
  kind text,
  data jsonb,
  revision bigint,
  deleted boolean,
  created_at timestamptz,
  updated_at timestamptz,
  owner_user_id uuid
)
language sql stable security invoker set search_path=''
as $$ select * from private.crm_get_board() $$;

revoke all on function public.crm_get_board() from public,anon,authenticated;
grant execute on function public.crm_get_board() to authenticated;
