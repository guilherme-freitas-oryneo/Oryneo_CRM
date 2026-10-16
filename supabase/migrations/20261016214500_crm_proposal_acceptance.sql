-- F01: immutability of the commercial selection and auditable, token-bound acceptance.
-- All writes are server-controlled; no client-side mutation of commercial conditions.
create table if not exists public.crm_proposals (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.crm_records(id) on delete restrict,
  version integer not null check (version > 0),
  public_token_hash text not null unique check (public_token_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'sent' check (status in ('sent','accepted','superseded','expired')),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  snapshot_sha256 text not null check (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  contact_email text not null,
  customer_name text not null,
  company text not null,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_name text,
  accepted_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (deal_id, version),
  constraint crm_proposal_accepted_coherent check (
    status <> 'accepted' or (accepted_at is not null and accepted_name is not null and accepted_email is not null)
  )
);
create index if not exists crm_proposals_deal_version on public.crm_proposals(deal_id,version desc);
alter table public.crm_proposals enable row level security;
revoke all on public.crm_proposals from public, anon, authenticated;
grant select on public.crm_proposals to authenticated;
create policy crm_proposals_member_read on public.crm_proposals for select to authenticated
 using (exists (select 1 from public.crm_members where user_id = (select auth.uid())));
-- A payment belongs to a single accepted, immutable proposal; older orders remain readable.
alter table public.crm_billing_orders add column if not exists proposal_id uuid references public.crm_proposals(id) on delete restrict;
create unique index if not exists crm_billing_orders_proposal_once on public.crm_billing_orders(proposal_id) where proposal_id is not null;

create or replace function public.crm_issue_proposal(
 p_deal_id uuid, p_by uuid, p_token_hash text, p_snapshot jsonb,
 p_snapshot_sha256 text, p_contact_email text, p_customer_name text, p_company text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_version integer; v_id uuid; v_member boolean;
begin
 if p_deal_id is null or p_by is null or p_snapshot is null
   or p_token_hash !~ '^[a-f0-9]{64}$' or p_snapshot_sha256 !~ '^[a-f0-9]{64}$'
   or length(trim(coalesce(p_customer_name,''))) not between 2 and 180
   or length(trim(coalesce(p_company,''))) not between 2 and 200
   or length(trim(coalesce(p_contact_email,''))) not between 5 and 254 then
   return jsonb_build_object('ok',false,'reason','invalid_input');
 end if;
 select exists(select 1 from public.crm_members where user_id=p_by) into v_member;
 if not v_member then return jsonb_build_object('ok',false,'reason','not_authorized'); end if;
 if not exists(select 1 from public.crm_records where id=p_deal_id and kind='deal' and not deleted)
   then return jsonb_build_object('ok',false,'reason','unknown_deal'); end if;
 perform pg_advisory_xact_lock(hashtextextended(p_deal_id::text,20261016));
 select coalesce(max(version),0)+1 into v_version from public.crm_proposals where deal_id=p_deal_id;
 update public.crm_proposals set status='superseded',updated_at=now()
  where deal_id=p_deal_id and status='sent';
 insert into public.crm_proposals
  (deal_id,version,public_token_hash,snapshot,snapshot_sha256,contact_email,customer_name,company,created_by)
 values (p_deal_id,v_version,p_token_hash,p_snapshot,p_snapshot_sha256,lower(trim(p_contact_email)),trim(p_customer_name),trim(p_company),p_by)
 returning id into v_id;
 return jsonb_build_object('ok',true,'id',v_id,'version',v_version);
end $$;

create or replace function public.crm_accept_proposal(
 p_token_hash text, p_name text, p_email text, p_snapshot_sha256 text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v public.crm_proposals;
begin
 if p_token_hash !~ '^[a-f0-9]{64}$' or p_snapshot_sha256 !~ '^[a-f0-9]{64}$'
    or length(trim(coalesce(p_name,''))) not between 2 and 180
    or length(trim(coalesce(p_email,''))) not between 5 and 254 then
    return jsonb_build_object('ok',false,'reason','invalid_input');
 end if;
 select * into v from public.crm_proposals where public_token_hash=p_token_hash for update;
 if not found then return jsonb_build_object('ok',false,'reason','invalid_link'); end if;
 if v.snapshot_sha256<>p_snapshot_sha256 then return jsonb_build_object('ok',false,'reason','version_changed'); end if;
 if lower(trim(p_email))<>lower(trim(v.contact_email)) then return jsonb_build_object('ok',false,'reason','email_mismatch'); end if;
 if v.status='accepted' then return jsonb_build_object('ok',true,'already_accepted',true,'version',v.version); end if;
 if v.status<>'sent' or v.expires_at<=now()
   then return jsonb_build_object('ok',false,'reason','expired_or_superseded'); end if;
 if exists(select 1 from public.crm_proposals other where other.deal_id=v.deal_id and other.version>v.version)
   then return jsonb_build_object('ok',false,'reason','newer_version_exists'); end if;
 update public.crm_proposals set status='accepted',accepted_at=now(),
   accepted_name=trim(p_name),accepted_email=lower(trim(p_email)),updated_at=now()
   where id=v.id and status='sent';
 return jsonb_build_object('ok',true,'id',v.id,'version',v.version);
end $$;

revoke all on function public.crm_issue_proposal(uuid,uuid,text,jsonb,text,text,text,text) from public,anon,authenticated;
revoke all on function public.crm_accept_proposal(text,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_issue_proposal(uuid,uuid,text,jsonb,text,text,text,text) to service_role;
grant execute on function public.crm_accept_proposal(text,text,text,text) to service_role;
