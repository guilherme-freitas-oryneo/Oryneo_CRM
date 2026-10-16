-- F05: record export requests independently of subscription cancellation.
-- Requests are NOT exports; verification and file delivery remain a separate authorized action.
create table public.crm_offboarding_requests (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.crm_billing_orders(id) on delete restrict,
 request_type text not null check(request_type in ('data_export','contract_clarification')),
 state text not null default 'awaiting_identity_review'
  check(state in ('awaiting_identity_review','in_review','fulfilled','rejected')),
 requester_name text not null check(length(requester_name) between 2 and 180),
 requester_email text not null check(length(requester_email) between 5 and 254),
 details text check(length(details)<=1000),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 review_note text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(order_id,request_type)
);
alter table public.crm_offboarding_requests enable row level security;
revoke all on public.crm_offboarding_requests from public,anon,authenticated;
grant select on public.crm_offboarding_requests to authenticated;
create policy crm_offboarding_member_read on public.crm_offboarding_requests for select to authenticated
 using(exists(select 1 from public.crm_members where user_id=(select auth.uid())));
create index crm_offboarding_requests_created on public.crm_offboarding_requests(created_at desc);

create or replace function public.crm_request_offboarding(
 p_order_id uuid,p_type text,p_name text,p_email text,p_details text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_email text;v_existing uuid;v_id uuid;
begin
 if p_order_id is null or p_type not in ('data_export','contract_clarification')
  or length(trim(coalesce(p_name,''))) not between 2 and 180
  or length(trim(coalesce(p_email,''))) not between 5 and 254
  or length(coalesce(p_details,''))>1000
 then return jsonb_build_object('ok',false,'reason','invalid_input');end if;
 select lower(trim(customer_email)) into v_email from public.crm_billing_orders
  where id=p_order_id and status in ('paid','canceled');
 if v_email is null or v_email<>lower(trim(p_email))
  then return jsonb_build_object('ok',false,'reason','not_authorized');end if;
 insert into public.crm_offboarding_requests(order_id,request_type,requester_name,requester_email,details)
 values(p_order_id,p_type,trim(p_name),lower(trim(p_email)),nullif(trim(coalesce(p_details,'')),''))
 on conflict(order_id,request_type) do nothing
 returning id into v_id;
 if v_id is null then
   select id into v_existing from public.crm_offboarding_requests
    where order_id=p_order_id and request_type=p_type;
   return jsonb_build_object('ok',true,'already_requested',true,'request_id',v_existing);
 end if;
 return jsonb_build_object('ok',true,'request_id',v_id,'already_requested',false);
end $$;
revoke all on function public.crm_request_offboarding(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_request_offboarding(uuid,text,text,text,text) to service_role;

create or replace function public.crm_review_offboarding(
 p_id uuid,p_state text,p_note text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
begin
 if p_id is null or p_actor is null or
   p_state not in ('in_review','fulfilled','rejected')
   or length(coalesce(p_note,''))>2000
   or (p_state in ('fulfilled','rejected') and length(trim(coalesce(p_note,'')))<10)
 then return jsonb_build_object('ok',false,'reason','invalid_input');end if;
 if not exists(select 1 from public.crm_members where user_id=p_actor)
   then return jsonb_build_object('ok',false,'reason','not_authorized');end if;
 update public.crm_offboarding_requests set
  state=p_state,reviewed_by=p_actor,reviewed_at=now(),review_note=p_note,updated_at=now()
  where id=p_id;
 if not found then return jsonb_build_object('ok',false,'reason','not_found');end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.crm_review_offboarding(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.crm_review_offboarding(uuid,text,text,uuid) to service_role;
