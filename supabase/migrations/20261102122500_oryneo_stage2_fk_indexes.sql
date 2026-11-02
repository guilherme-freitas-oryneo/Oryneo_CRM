-- Stage 2 post-deploy hardening: covering indexes for the two new foreign keys.
-- These are additive and do not change runtime state, ownership, schedules, or data.

CREATE INDEX IF NOT EXISTS automation_email_consents_opportunity_fk_idx
  ON public.automation_email_consents(opportunity_id);

CREATE INDEX IF NOT EXISTS automation_live_waits_conversation_fk_idx
  ON public.automation_live_waits(conversation_id)
  WHERE conversation_id IS NOT NULL;
