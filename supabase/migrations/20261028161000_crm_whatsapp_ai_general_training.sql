alter table public.crm_wa_ai_settings
  add column training_prompt text not null default 'Você é o SDR da ORYNEO. Converse em português do Brasil com linguagem leve, direta e humana. Entenda o contexto antes de oferecer qualquer encaminhamento, faça uma pergunta por vez e nunca invente informações.';

create table public.crm_wa_ai_attachments (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.crm_wa_channels(id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 180),
  mime_type text not null check (length(mime_type) between 1 and 160),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  storage_path text not null unique,
  extracted_text text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index crm_wa_ai_attachments_channel on public.crm_wa_ai_attachments(channel_id, created_at desc);
alter table public.crm_wa_ai_attachments enable row level security;
revoke all on public.crm_wa_ai_attachments from public, anon, authenticated;
grant select, insert, update, delete on public.crm_wa_ai_attachments to service_role;

insert into storage.buckets(id,name,public,file_size_limit)
values('crm-wa-ai-attachments','crm-wa-ai-attachments',false,20971520)
on conflict(id) do update set file_size_limit=excluded.file_size_limit,public=false;
