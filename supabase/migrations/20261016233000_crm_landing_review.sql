-- F04: approve an immutable HTML snapshot of a client landing page before publication.
-- The static page's SHA-256 is checked by both issue and approval endpoints.
create table public.crm_landing_reviews(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.crm_billing_orders(id) on delete restrict,
 version integer not null check(version>0),
 review_token_hash text not null unique check(review_token_hash ~ '^[a-f0-9]{64}$'),
 preview_url text not null check(length(preview_url) between 20 and 1200),
 preview_html_sha256 text not null check(preview_html_sha256 ~ '^[a-f0-9]{64}$'),
 status text not null default 'review' check(status in ('review','approved','superseded','published')),
 created_by uuid not null references auth.users(id),
 accepted_at timestamptz,
 accepted_name text,
 accepted_email text,
 published_at timestamptz,
 published_url text,
 expires_at timestamptz not null default (now()+interval '14 days'),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(order_id,version),
 check(status not in ('approved','published') or
  (accepted_at is not null and accepted_name is not null and accepted_email is not null)),
 check(status <> 'published' or (published_at is not null and published_url is not null))
);
create index crm_landing_reviews_order_version on public.crm_landing_reviews(order_id,version desc);
alter table public.crm_landing_reviews enable row level security;
revoke all on public.crm_landing_reviews from public,anon,authenticated;
grant select on public.crm_landing_reviews to authenticated;
create policy crm_landing_reviews_members_read on public.crm_landing_reviews for select to authenticated
 using (exists(select 1 from public.crm_members where user_id=(select auth.uid())));

create or replace function public.crm_issue_landing_review(
 p_order_id uuid,p_preview_url text,p_preview_html_sha256 text,p_review_token_hash text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_version integer;v_id uuid;
begin
 if p_order_id is null or p_actor is null
   or p_preview_html_sha256 !~ '^[a-f0-9]{64}$' or p_review_token_hash !~ '^[a-f0-9]{64}$'
   or length(trim(coalesce(p_preview_url,''))) not between 20 and 1200
   then return jsonb_build_object('ok',false,'reason','invalid_input');end if;
 if not exists(select 1 from public.crm_members where user_id=p_actor)
   then return jsonb_build_object('ok',false,'reason','not_authorized');end if;
 if not exists(select 1 from public.crm_billing_orders o
  where o.id=p_order_id and o.status='paid' and (o.selection->'addons') ? 'landing-page')
  then return jsonb_build_object('ok',false,'reason','landing_not_contracted_or_unpaid');end if;
 perform pg_advisory_xact_lock(hashtextextended(p_order_id::text,20261018));
 select coalesce(max(version),0)+1 into v_version from public.crm_landing_reviews where order_id=p_order_id;
 update public.crm_landing_reviews set status='superseded',updated_at=now()
  where order_id=p_order_id and status='review';
 insert into public.crm_landing_reviews(order_id,version,preview_url,preview_html_sha256,review_token_hash,created_by)
 values (p_order_id,v_version,trim(p_preview_url),p_preview_html_sha256,p_review_token_hash,p_actor) returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id,'version',v_version);
end $$;

create or replace function public.crm_approve_landing_review(
 p_order_id uuid,p_version integer,p_preview_html_sha256 text,p_name text,p_email text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v public.crm_landing_reviews;v_recipient text;
begin
 if p_order_id is null or p_version is null or p_version<1
   or p_preview_html_sha256 !~ '^[a-f0-9]{64}$'
   or length(trim(coalesce(p_name,''))) not between 2 and 180
   or length(trim(coalesce(p_email,''))) not between 5 and 254
   then return jsonb_build_object('ok',false,'reason','invalid_input');end if;
 select r.* into v from public.crm_landing_reviews r
   where r.order_id=p_order_id and r.version=p_version for update;
 if not found then return jsonb_build_object('ok',false,'reason','not_found');end if;
 if v.preview_html_sha256<>p_preview_html_sha256
   then return jsonb_build_object('ok',false,'reason','design_changed');end if;
 select lower(trim(customer_email)) into v_recipient from public.crm_billing_orders where id=p_order_id and status='paid';
 if v_recipient is null or v_recipient<>lower(trim(p_email))
   then return jsonb_build_object('ok',false,'reason','email_mismatch');end if;
 if v.status in ('approved','published')
   then return jsonb_build_object('ok',true,'already_approved',true,'version',v.version);end if;
 if v.status<>'review' or v.expires_at<=now()
   or exists(select 1 from public.crm_landing_reviews where order_id=p_order_id and version>v.version)
   then return jsonb_build_object('ok',false,'reason','expired_or_superseded');end if;
 update public.crm_landing_reviews set status='approved',accepted_at=now(),
  accepted_name=trim(p_name),accepted_email=lower(trim(p_email)),updated_at=now()
  where id=v.id and status='review';
 return jsonb_build_object('ok',true,'version',v.version);
end $$;

create or replace function public.crm_publish_landing_review(
 p_order_id uuid,p_version integer,p_published_url text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v public.crm_landing_reviews;
begin
 if p_order_id is null or p_version<1 or p_actor is null or
    length(trim(coalesce(p_published_url,''))) not between 20 and 1200
   then return jsonb_build_object('ok',false,'reason','invalid_input');end if;
 if not exists(select 1 from public.crm_members where user_id=p_actor)
   then return jsonb_build_object('ok',false,'reason','not_authorized');end if;
 select * into v from public.crm_landing_reviews
  where order_id=p_order_id and version=p_version for update;
 if not found then return jsonb_build_object('ok',false,'reason','not_found');end if;
 if v.status<>'approved'
  or exists(select 1 from public.crm_landing_reviews where order_id=p_order_id and version>v.version)
   then return jsonb_build_object('ok',false,'reason','not_approved_or_outdated');end if;
 update public.crm_landing_reviews set status='published',published_url=trim(p_published_url),
  published_at=now(),updated_at=now() where id=v.id;
 return jsonb_build_object('ok',true,'version',v.version);
end $$;
revoke all on function public.crm_issue_landing_review(uuid,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.crm_approve_landing_review(uuid,integer,text,text,text) from public,anon,authenticated;
revoke all on function public.crm_publish_landing_review(uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.crm_issue_landing_review(uuid,text,text,text,uuid) to service_role;
grant execute on function public.crm_approve_landing_review(uuid,integer,text,text,text) to service_role;
grant execute on function public.crm_publish_landing_review(uuid,integer,text,uuid) to service_role;
