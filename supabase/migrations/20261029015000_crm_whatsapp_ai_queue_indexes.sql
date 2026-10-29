create index if not exists crm_wa_ai_jobs_channel
  on public.crm_wa_ai_jobs(channel_id);

create index if not exists crm_wa_ai_outbox_conversation
  on public.crm_wa_ai_outbox(conversation_id);
