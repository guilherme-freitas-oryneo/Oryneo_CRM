-- Signed Meta deliveries are stored before ACK. No browser role can read raw payloads.
create table public.crm_wa_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_sha256 text not null unique check (event_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and payload->>'object' = 'whatsapp_business_account'
    and octet_length(payload::text) <= 262144
  ),
  state text not null default 'pending' check (state in ('pending', 'processing', 'processed', 'dead')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_error_code text check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{2,80}$'),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index crm_wa_webhook_events_pending on public.crm_wa_webhook_events(received_at, id)
  where state = 'pending';

alter table public.crm_wa_webhook_events enable row level security;
revoke all on public.crm_wa_webhook_events from anon, authenticated;
grant select, insert, update on public.crm_wa_webhook_events to service_role;
-- No authenticated or anon policy is created: the raw Meta delivery is service-only.
