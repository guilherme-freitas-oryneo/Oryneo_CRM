-- ORYNEO Commercial Playbook: draft migration, PR only. No production apply.
-- Content lives in versioned front-end files. Only user progress and annotations are persisted.
create table if not exists public.crm_playbook_annotations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.crm_members(user_id) on delete cascade,
  slide_id text not null check (slide_id ~ '^[0-9]{2}$'),
  block_key text not null check (block_key ~ '^(lead|decision|p[0-3])$'),
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset > start_offset and end_offset <= 6000),
  quote text not null check (char_length(quote) between 1 and 2000),
  note text not null default '' check (char_length(note) <= 4000),
  color text not null default 'yellow' check (color in ('yellow','blue','mint')),
  visibility text not null default 'private' check (visibility in ('private','team')),
  content_version text not null check (char_length(content_version) between 1 and 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_playbook_annotations_slide_idx
  on public.crm_playbook_annotations(slide_id, created_at desc);
create index if not exists crm_playbook_annotations_user_idx
  on public.crm_playbook_annotations(user_id, created_at desc);
alter table public.crm_playbook_annotations enable row level security;
revoke all on public.crm_playbook_annotations from public, anon;
grant select, insert, update, delete on public.crm_playbook_annotations to authenticated;
grant all on public.crm_playbook_annotations to service_role;
create policy crm_playbook_annotations_read on public.crm_playbook_annotations
for select to authenticated
using (
  exists(select 1 from public.crm_members m where m.user_id = (select auth.uid()))
  and (user_id = (select auth.uid()) or visibility = 'team')
);
create policy crm_playbook_annotations_insert on public.crm_playbook_annotations
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists(select 1 from public.crm_members m where m.user_id = (select auth.uid()))
);
create policy crm_playbook_annotations_update on public.crm_playbook_annotations
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists(select 1 from public.crm_members m where m.user_id = (select auth.uid()))
);
create policy crm_playbook_annotations_delete on public.crm_playbook_annotations
for delete to authenticated
using (user_id = (select auth.uid()));

create table if not exists public.crm_playbook_progress (
  user_id uuid primary key references public.crm_members(user_id) on delete cascade,
  last_slide_id text not null check (last_slide_id ~ '^[0-9]{2}$'),
  updated_at timestamptz not null default now()
);
alter table public.crm_playbook_progress enable row level security;
revoke all on public.crm_playbook_progress from public, anon;
grant select, insert, update, delete on public.crm_playbook_progress to authenticated;
grant all on public.crm_playbook_progress to service_role;
create policy crm_playbook_progress_read on public.crm_playbook_progress
for select to authenticated
using (user_id = (select auth.uid()));
create policy crm_playbook_progress_insert on public.crm_playbook_progress
for insert to authenticated
with check (user_id = (select auth.uid()));
create policy crm_playbook_progress_update on public.crm_playbook_progress
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
create policy crm_playbook_progress_delete on public.crm_playbook_progress
for delete to authenticated
using (user_id = (select auth.uid()));
