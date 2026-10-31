-- Additive post-deployment index remediation; existing runtime remains disabled.
CREATE INDEX IF NOT EXISTS automation_sdr_pair_knowledge_fk_idx ON public.automation_sdr_active_release(knowledge_release_id) WHERE knowledge_release_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS automation_sdr_pair_dictionary_fk_idx ON public.automation_sdr_active_release(dictionary_release_id) WHERE dictionary_release_id IS NOT NULL;
