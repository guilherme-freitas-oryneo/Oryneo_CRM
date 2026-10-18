-- Draft body/attachments are visible only to their author; shared mailbox reads unchanged.
alter table public.crm_mail_drafts add column if not exists compose_meta jsonb not null default '{}'::jsonb;
alter policy crm_mail_drafts_member_read on public.crm_mail_drafts
  using ((select public.crm_mail_is_member()) and created_by=(select auth.uid()));
