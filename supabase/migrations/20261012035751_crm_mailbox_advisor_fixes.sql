-- Make intentional denial explicit and cover every mailbox foreign key used by cascades.
create policy crm_mail_internal_config_deny_clients on public.crm_mail_internal_config
for all to anon, authenticated using (false) with check (false);

create policy crm_mailbox_locks_deny_clients on public.crm_mailbox_locks
for all to anon, authenticated using (false) with check (false);

create index crm_mail_deal_links_linked_by on public.crm_mail_deal_links(linked_by);
create index crm_mail_drafts_created_by on public.crm_mail_drafts(created_by);
create index crm_mail_drafts_thread on public.crm_mail_drafts(thread_id);
create index crm_mail_drafts_reply_to on public.crm_mail_drafts(reply_to_message_id);
create index crm_mail_outbox_created_by on public.crm_mail_outbox(created_by);
create index crm_mail_outbox_draft on public.crm_mail_outbox(draft_id);
create index crm_mail_outbox_message on public.crm_mail_outbox(message_id);
