grant select,insert,update,delete on table
  public.crm_mailboxes,
  public.crm_mail_folders,
  public.crm_mail_threads,
  public.crm_mail_messages,
  public.crm_mail_locations,
  public.crm_mail_attachments,
  public.crm_mail_drafts,
  public.crm_mail_outbox,
  public.crm_mail_deal_links,
  public.crm_mail_sync_runs,
  public.crm_mailbox_locks,
  public.crm_mail_internal_config
to service_role;
