-- ORYNEO Macro 6: Meta transport lease with independent provider binding.
-- PREVIEW ONLY. No sender, no activation and no legacy cutover here.
BEGIN;
CREATE TABLE IF NOT EXISTS public.automation_whatsapp_provider_bindings(
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 crm_channel_id uuid NOT NULL REFERENCES public.crm_wa_channels(id) ON DELETE RESTRICT,
 whatsapp_account_id text NOT NULL CHECK(whatsapp_account_id ~ '^[0-9]{8,24}$'),
 messaging_account_id text NOT NULL CHECK(messaging_account_id ~ '^[0-9]{8,24}$'),
 phone_number_id text NOT NULL CHECK(phone_number_id ~ '^[0-9]{8,24}$'),
 verified_by uuid,
 verified_at timestamptz,
 release_approved_by uuid,
 release_approved_at timestamptz,
 enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,crm_channel_id),
 CONSTRAINT automation_meta_verified_release CHECK(
  enabled IS FALSE OR
  (verified_by IS NOT NULL AND verified_at IS NOT NULL
   AND release_approved_by IS NOT NULL AND release_approved_at IS NOT NULL
   AND release_approved_at>=verified_at))
);
ALTER TABLE public.automation_whatsapp_provider_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_whatsapp_provider_bindings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_whatsapp_provider_bindings TO service_role;
CREATE INDEX IF NOT EXISTS automation_whatsapp_provider_phone_idx
 ON public.automation_whatsapp_provider_bindings(workspace_id,phone_number_id);

-- Marketing requires separate, verified opt-in proof. The existing CRM
-- conversation consent flag by itself is NOT an advertisement opt-in.
CREATE TABLE IF NOT EXISTS public.automation_whatsapp_marketing_consents(
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 conversation_id uuid NOT NULL REFERENCES public.crm_wa_conversations(id) ON DELETE RESTRICT,
 purpose text NOT NULL DEFAULT 'commercial_followup'
  CHECK(purpose='commercial_followup'),
 granted_at timestamptz NOT NULL,
 proof_kind text NOT NULL CHECK(proof_kind IN('opt_in_form','signed_agreement','explicit_inbound')),
 proof_sha256 text NOT NULL CHECK(proof_sha256 ~ '^[0-9a-f]{64}
 p_workspace_id uuid,p_limit integer DEFAULT 3
) RETURNS TABLE(action_id uuid,claim_token uuid,action_key text,
 conversation_id uuid,template_registry_id uuid,phone_number_id text,
 whatsapp_account_id text,messaging_account_id text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5
 THEN RAISE EXCEPTION 'META_CLAIM_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
 JOIN public.automation_channel_ownership owner ON owner.workspace_id=w.id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active
 AND s.mode='live' AND NOT s.emergency_stop
 AND owner.channel='whatsapp' AND owner.owner='new_engine'
 AND owner.legacy_dispatch_paused_at IS NOT NULL
 AND owner.release_approved_at IS NOT NULL AND owner.release_id IS NOT NULL)
 THEN RETURN; END IF;
 RETURN QUERY
 WITH ready AS(
  SELECT a.id,i.context_refs,reg.id AS registry_id,
    conv.id AS conversation_id,b.phone_number_id,
    b.whatsapp_account_id,b.messaging_account_id
  FROM public.automation_action_outbox a
  JOIN public.automation_executions e ON e.id=a.execution_id
   AND e.workspace_id=a.workspace_id AND e.state='running'
  JOIN public.automation_event_inbox i ON i.id=e.inbox_id
   AND i.workspace_id=e.workspace_id AND i.state='processed'
  JOIN public.automation_flow_versions v ON v.id=e.flow_version_id
   AND v.workspace_id=e.workspace_id AND v.status='published'
  JOIN public.automation_flows f ON f.id=v.flow_id
   AND f.workspace_id=v.workspace_id AND f.enabled
   AND f.published_version_id=v.id
  JOIN public.crm_wa_conversations conv
   ON conv.id=CASE WHEN (i.context_refs->>'conversation_id') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (i.context_refs->>'conversation_id')::uuid ELSE NULL END
   AND conv.mode='sdr_active' AND conv.opted_out IS FALSE
   AND conv.consent_granted IS TRUE
  JOIN public.crm_wa_channels ch ON ch.id=conv.channel_id AND ch.enabled
  JOIN public.automation_whatsapp_provider_bindings b
   ON b.workspace_id=a.workspace_id AND b.crm_channel_id=ch.id AND b.enabled
   AND b.messaging_account_id=ch.messaging_account_id
   AND b.phone_number_id=ch.phone_number_id
  JOIN public.automation_template_registry reg
   ON reg.workspace_id=a.workspace_id
   AND reg.provider_account_id=b.messaging_account_id
   AND reg.provider_status='APPROVED'
   AND reg.category IN ('UTILITY','MARKETING')
   AND reg.language='pt_BR'
   AND reg.parameter_schema->>'components_verified'='true'
  WHERE a.workspace_id=p_workspace_id AND a.action_type='whatsapp_template'
   AND a.state='queued' AND a.attempts<3
   AND (a.due_at IS NULL OR a.due_at<=clock_timestamp())
   AND (conv.last_inbound_at IS NULL OR conv.last_inbound_at<i.received_at)
   AND (reg.category='UTILITY' OR EXISTS(
     SELECT 1 FROM public.automation_whatsapp_marketing_consents consent
     WHERE consent.workspace_id=a.workspace_id
      AND consent.conversation_id=conv.id
      AND consent.purpose='commercial_followup'
      AND consent.revoked_at IS NULL
      AND consent.proof_sha256 ~ '^[0-9a-f]{64}
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n
    WHERE n->>'id'=a.node_id AND n->>'type'='whatsapp_template'
      AND n->'config'->>'template_registry_id'=reg.id::text)
  ORDER BY a.due_at NULLS FIRST,a.created_at,a.id LIMIT p_limit
  FOR UPDATE OF a SKIP LOCKED
 ),leased AS(
  UPDATE public.automation_action_outbox a SET
   state='leased',claim_token=gen_random_uuid(),attempts=a.attempts+1,
   claimed_at=clock_timestamp(),lease_until=clock_timestamp()+interval '90 seconds'
  FROM ready r WHERE a.id=r.id
  RETURNING a.id,a.claim_token,a.action_key
 )
 SELECT l.id,l.claim_token,l.action_key,r.conversation_id,r.registry_id,
 r.phone_number_id,r.whatsapp_account_id,r.messaging_account_id
 FROM leased l JOIN ready r ON r.id=l.id;
END $fn$;
REVOKE ALL ON FUNCTION public.automation_whatsapp_claim_template(uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_whatsapp_claim_template(uuid,integer)
 TO service_role;
COMMIT;
),
 verified_by uuid NOT NULL,
 verified_at timestamptz NOT NULL,
 revoked_at timestamptz,
 PRIMARY KEY(workspace_id,conversation_id,purpose),
 CONSTRAINT automation_marketing_consent_verified_after_grant
  CHECK(verified_at>=granted_at),
 CONSTRAINT automation_marketing_consent_revoked_after_grant
  CHECK(revoked_at IS NULL OR revoked_at>=granted_at)
);
ALTER TABLE public.automation_whatsapp_marketing_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_whatsapp_marketing_consents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_whatsapp_marketing_consents TO service_role;
CREATE INDEX IF NOT EXISTS automation_wa_consent_recent_idx
 ON public.automation_whatsapp_marketing_consents(workspace_id,verified_at DESC)
 WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.automation_whatsapp_claim_template(
 p_workspace_id uuid,p_limit integer DEFAULT 3
) RETURNS TABLE(action_id uuid,claim_token uuid,action_key text,
 conversation_id uuid,template_registry_id uuid,phone_number_id text,
 whatsapp_account_id text,messaging_account_id text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5
 THEN RAISE EXCEPTION 'META_CLAIM_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
 JOIN public.automation_channel_ownership owner ON owner.workspace_id=w.id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active
 AND s.mode='live' AND NOT s.emergency_stop
 AND owner.channel='whatsapp' AND owner.owner='new_engine'
 AND owner.legacy_dispatch_paused_at IS NOT NULL
 AND owner.release_approved_at IS NOT NULL AND owner.release_id IS NOT NULL)
 THEN RETURN; END IF;
 RETURN QUERY
 WITH ready AS(
  SELECT a.id,i.context_refs,reg.id AS registry_id,
    conv.id AS conversation_id,b.phone_number_id,
    b.whatsapp_account_id,b.messaging_account_id
  FROM public.automation_action_outbox a
  JOIN public.automation_executions e ON e.id=a.execution_id
   AND e.workspace_id=a.workspace_id AND e.state='running'
  JOIN public.automation_event_inbox i ON i.id=e.inbox_id
   AND i.workspace_id=e.workspace_id AND i.state='processed'
  JOIN public.automation_flow_versions v ON v.id=e.flow_version_id
   AND v.workspace_id=e.workspace_id AND v.status='published'
  JOIN public.automation_flows f ON f.id=v.flow_id
   AND f.workspace_id=v.workspace_id AND f.enabled
   AND f.published_version_id=v.id
  JOIN public.crm_wa_conversations conv
   ON conv.id=CASE WHEN (i.context_refs->>'conversation_id') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (i.context_refs->>'conversation_id')::uuid ELSE NULL END
   AND conv.mode='sdr_active' AND conv.opted_out IS FALSE
   AND conv.consent_granted IS TRUE
  JOIN public.crm_wa_channels ch ON ch.id=conv.channel_id AND ch.enabled
  JOIN public.automation_whatsapp_provider_bindings b
   ON b.workspace_id=a.workspace_id AND b.crm_channel_id=ch.id AND b.enabled
   AND b.messaging_account_id=ch.messaging_account_id
   AND b.phone_number_id=ch.phone_number_id
  JOIN public.automation_template_registry reg
   ON reg.workspace_id=a.workspace_id
   AND reg.provider_account_id=b.messaging_account_id
   AND reg.provider_status='APPROVED'
   AND reg.category='UTILITY'
   AND reg.language='pt_BR'
   AND reg.parameter_schema->>'components_verified'='true'
  WHERE a.workspace_id=p_workspace_id AND a.action_type='whatsapp_template'
   AND a.state='queued' AND a.attempts<3
   AND (a.due_at IS NULL OR a.due_at<=clock_timestamp())
   AND (conv.last_inbound_at IS NULL OR conv.last_inbound_at<i.received_at)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n
    WHERE n->>'id'=a.node_id AND n->>'type'='whatsapp_template'
      AND n->'config'->>'template_registry_id'=reg.id::text)
  ORDER BY a.due_at NULLS FIRST,a.created_at,a.id LIMIT p_limit
  FOR UPDATE OF a SKIP LOCKED
 ),leased AS(
  UPDATE public.automation_action_outbox a SET
   state='leased',claim_token=gen_random_uuid(),attempts=a.attempts+1,
   claimed_at=clock_timestamp(),lease_until=clock_timestamp()+interval '90 seconds'
  FROM ready r WHERE a.id=r.id
  RETURNING a.id,a.claim_token,a.action_key
 )
 SELECT l.id,l.claim_token,l.action_key,r.conversation_id,r.registry_id,
 r.phone_number_id,r.whatsapp_account_id,r.messaging_account_id
 FROM leased l JOIN ready r ON r.id=l.id;
END $fn$;
REVOKE ALL ON FUNCTION public.automation_whatsapp_claim_template(uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_whatsapp_claim_template(uuid,integer)
 TO service_role;
COMMIT;

      AND consent.verified_at IS NOT NULL))
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n
    WHERE n->>'id'=a.node_id AND n->>'type'='whatsapp_template'
      AND n->'config'->>'template_registry_id'=reg.id::text)
  ORDER BY a.due_at NULLS FIRST,a.created_at,a.id LIMIT p_limit
  FOR UPDATE OF a SKIP LOCKED
 ),leased AS(
  UPDATE public.automation_action_outbox a SET
   state='leased',claim_token=gen_random_uuid(),attempts=a.attempts+1,
   claimed_at=clock_timestamp(),lease_until=clock_timestamp()+interval '90 seconds'
  FROM ready r WHERE a.id=r.id
  RETURNING a.id,a.claim_token,a.action_key
 )
 SELECT l.id,l.claim_token,l.action_key,r.conversation_id,r.registry_id,
 r.phone_number_id,r.whatsapp_account_id,r.messaging_account_id
 FROM leased l JOIN ready r ON r.id=l.id;
END $fn$;
REVOKE ALL ON FUNCTION public.automation_whatsapp_claim_template(uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_whatsapp_claim_template(uuid,integer)
 TO service_role;
COMMIT;
),
 verified_by uuid NOT NULL,
 verified_at timestamptz NOT NULL,
 revoked_at timestamptz,
 PRIMARY KEY(workspace_id,conversation_id,purpose),
 CONSTRAINT automation_marketing_consent_verified_after_grant
  CHECK(verified_at>=granted_at),
 CONSTRAINT automation_marketing_consent_revoked_after_grant
  CHECK(revoked_at IS NULL OR revoked_at>=granted_at)
);
ALTER TABLE public.automation_whatsapp_marketing_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_whatsapp_marketing_consents FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_whatsapp_marketing_consents TO service_role;
CREATE INDEX IF NOT EXISTS automation_wa_consent_recent_idx
 ON public.automation_whatsapp_marketing_consents(workspace_id,verified_at DESC)
 WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.automation_whatsapp_claim_template(
 p_workspace_id uuid,p_limit integer DEFAULT 3
) RETURNS TABLE(action_id uuid,claim_token uuid,action_key text,
 conversation_id uuid,template_registry_id uuid,phone_number_id text,
 whatsapp_account_id text,messaging_account_id text)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5
 THEN RAISE EXCEPTION 'META_CLAIM_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
 JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
 JOIN public.automation_channel_ownership owner ON owner.workspace_id=w.id
 WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active
 AND s.mode='live' AND NOT s.emergency_stop
 AND owner.channel='whatsapp' AND owner.owner='new_engine'
 AND owner.legacy_dispatch_paused_at IS NOT NULL
 AND owner.release_approved_at IS NOT NULL AND owner.release_id IS NOT NULL)
 THEN RETURN; END IF;
 RETURN QUERY
 WITH ready AS(
  SELECT a.id,i.context_refs,reg.id AS registry_id,
    conv.id AS conversation_id,b.phone_number_id,
    b.whatsapp_account_id,b.messaging_account_id
  FROM public.automation_action_outbox a
  JOIN public.automation_executions e ON e.id=a.execution_id
   AND e.workspace_id=a.workspace_id AND e.state='running'
  JOIN public.automation_event_inbox i ON i.id=e.inbox_id
   AND i.workspace_id=e.workspace_id AND i.state='processed'
  JOIN public.automation_flow_versions v ON v.id=e.flow_version_id
   AND v.workspace_id=e.workspace_id AND v.status='published'
  JOIN public.automation_flows f ON f.id=v.flow_id
   AND f.workspace_id=v.workspace_id AND f.enabled
   AND f.published_version_id=v.id
  JOIN public.crm_wa_conversations conv
   ON conv.id=CASE WHEN (i.context_refs->>'conversation_id') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN (i.context_refs->>'conversation_id')::uuid ELSE NULL END
   AND conv.mode='sdr_active' AND conv.opted_out IS FALSE
   AND conv.consent_granted IS TRUE
  JOIN public.crm_wa_channels ch ON ch.id=conv.channel_id AND ch.enabled
  JOIN public.automation_whatsapp_provider_bindings b
   ON b.workspace_id=a.workspace_id AND b.crm_channel_id=ch.id AND b.enabled
   AND b.messaging_account_id=ch.messaging_account_id
   AND b.phone_number_id=ch.phone_number_id
  JOIN public.automation_template_registry reg
   ON reg.workspace_id=a.workspace_id
   AND reg.provider_account_id=b.messaging_account_id
   AND reg.provider_status='APPROVED'
   AND reg.category='UTILITY'
   AND reg.language='pt_BR'
   AND reg.parameter_schema->>'components_verified'='true'
  WHERE a.workspace_id=p_workspace_id AND a.action_type='whatsapp_template'
   AND a.state='queued' AND a.attempts<3
   AND (a.due_at IS NULL OR a.due_at<=clock_timestamp())
   AND (conv.last_inbound_at IS NULL OR conv.last_inbound_at<i.received_at)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n
    WHERE n->>'id'=a.node_id AND n->>'type'='whatsapp_template'
      AND n->'config'->>'template_registry_id'=reg.id::text)
  ORDER BY a.due_at NULLS FIRST,a.created_at,a.id LIMIT p_limit
  FOR UPDATE OF a SKIP LOCKED
 ),leased AS(
  UPDATE public.automation_action_outbox a SET
   state='leased',claim_token=gen_random_uuid(),attempts=a.attempts+1,
   claimed_at=clock_timestamp(),lease_until=clock_timestamp()+interval '90 seconds'
  FROM ready r WHERE a.id=r.id
  RETURNING a.id,a.claim_token,a.action_key
 )
 SELECT l.id,l.claim_token,l.action_key,r.conversation_id,r.registry_id,
 r.phone_number_id,r.whatsapp_account_id,r.messaging_account_id
 FROM leased l JOIN ready r ON r.id=l.id;
END $fn$;
REVOKE ALL ON FUNCTION public.automation_whatsapp_claim_template(uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_whatsapp_claim_template(uuid,integer)
 TO service_role;
COMMIT;
