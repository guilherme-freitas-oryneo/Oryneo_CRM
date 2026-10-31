-- Production migration successfully applied 20261031214032; mode disabled, no execution or outbound.
-- Keep history aligned; DO NOT rerun blindly.
BEGIN;
-- Exact tested SQL source: supabase/automation/commercial_channel_ownership.preview.sql (blob 8f873822388abe4af397dda75a87c2010bf12ef5)
-- ORYNEO Macro 3. PREVIEW ONLY: single-owner cutover guard.
-- This does NOT disable legacy workers, send messages, modify CRM or
-- authorize switching owners. New engine ownership requires a future
-- controlled release that proves the old dispatcher is actually paused.

CREATE TABLE IF NOT EXISTS public.automation_channel_ownership(
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 channel text NOT NULL CHECK(channel IN
  ('whatsapp','email','crm','onboarding','billing')),
 owner text NOT NULL DEFAULT 'legacy' CHECK(owner IN ('legacy','new_engine')),
 legacy_dispatch_paused_at timestamptz,
 release_approved_at timestamptz,
 release_id text,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,channel),
 CONSTRAINT automation_channel_new_owner_requires_verified_cutover CHECK (
  owner='legacy' OR
  (legacy_dispatch_paused_at IS NOT NULL AND release_approved_at IS NOT NULL
   AND release_id ~ '^[A-Za-z0-9._:-]{8,128}$'
   AND release_approved_at>=legacy_dispatch_paused_at))
);
ALTER TABLE public.automation_channel_ownership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.automation_channel_ownership FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_channel_ownership TO service_role;
-- A migration cannot inadvertently take over pre-existing channels.
INSERT INTO public.automation_channel_ownership(workspace_id,channel)
 SELECT w.id,c.channel FROM public.automation_workspaces w
 CROSS JOIN (VALUES ('whatsapp'),('email'),('crm'),('onboarding'),('billing')) AS c(channel)
 WHERE w.slug='oryneo-crm'
 ON CONFLICT(workspace_id,channel) DO NOTHING;

CREATE OR REPLACE FUNCTION public.automation_channel_cutover_preflight(
 p_workspace_id uuid,p_channel text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE v record;
BEGIN
 IF p_channel NOT IN ('whatsapp','email','crm','onboarding','billing')
   OR p_workspace_id IS NULL
 THEN RAISE EXCEPTION 'CHANNEL_PREFLIGHT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT o.owner,o.legacy_dispatch_paused_at,o.release_approved_at,o.release_id,
   w.active,s.mode,s.emergency_stop
 INTO v FROM public.automation_channel_ownership o
   JOIN public.automation_workspaces w ON w.id=o.workspace_id
   JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
 WHERE o.workspace_id=p_workspace_id AND o.channel=p_channel
   AND w.slug='oryneo-crm';
 IF NOT FOUND THEN RETURN jsonb_build_object('eligible',false,'code','OWNER_NOT_INITIALIZED','dispatchAuthorized',false); END IF;
 IF NOT v.active OR v.emergency_stop OR v.mode<>'live'
 THEN RETURN jsonb_build_object('eligible',false,'code','RUNTIME_DISABLED','dispatchAuthorized',false); END IF;
 IF v.owner<>'new_engine'
 THEN RETURN jsonb_build_object('eligible',false,'code','LEGACY_EXECUTOR_OWNER','dispatchAuthorized',false); END IF;
 IF v.legacy_dispatch_paused_at IS NULL OR v.release_approved_at IS NULL
   OR v.release_id IS NULL
 THEN RETURN jsonb_build_object('eligible',false,'code','CUTOVER_NOT_ATTESTED','dispatchAuthorized',false); END IF;
 -- This is a metadata-only preflight, never a permission to call the provider.
 RETURN jsonb_build_object('eligible',true,'code','OWNER_PREFLIGHT_ONLY',
   'dispatchAuthorized',false);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_channel_cutover_preflight(uuid,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_channel_cutover_preflight(uuid,text)
 TO service_role;


-- Exact tested SQL source: supabase/automation/commercial_sources.preview.sql (blob 4de3ad773a12320339cdc5aa9e3132903e020e08)
-- ORYNEO Macro 3 — commercial source adapters, PREVIEW ONLY.
-- Read canonical CRM/Stripe journals. NO HTTP, SMTP, Meta, Stripe requests,
-- worker schedule, legacy dispatch change or production migration is performed.
-- Ingest only into the shadow event inbox, never into an outbound action queue.

CREATE TABLE IF NOT EXISTS public.automation_commercial_ingest_cursors(
 workspace_id uuid NOT NULL REFERENCES public.automation_workspaces(id) ON DELETE RESTRICT,
 stream text NOT NULL CHECK(stream IN ('intake','checkout','billing','mail','delivery','proposal','meeting','handoff')),
 last_at timestamptz NOT NULL,
 last_key text NOT NULL DEFAULT '',
 initialized_by uuid,
 initialized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,stream)
);
ALTER TABLE public.automation_commercial_ingest_cursors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.automation_commercial_ingest_cursors FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.automation_commercial_ingest_cursors TO service_role;

-- Preserve immutable source identities. No contact details, invoice payloads,
-- message content or payment method data are copied to the inbox.
CREATE OR REPLACE VIEW public.automation_commercial_source_feed
WITH (security_invoker=true) AS
 SELECT 'intake'::text stream,r.created_at at_time,r.request_id::text at_key,
   'landing'::text source,'intake:'||r.request_id::text event_id,
   'lead.intake_received'::text event_type,
   jsonb_build_object('opportunity_id',r.deal_id::text) context_refs
 FROM public.crm_intake_requests r WHERE r.deal_id IS NOT NULL
 UNION ALL
 SELECT 'checkout',o.updated_at,o.id::text,'crm',
   'checkout:'||o.id::text,'checkout.started',
   jsonb_build_object('order_id',o.id::text,'opportunity_id',o.deal_id::text)
 FROM public.crm_billing_orders o
 WHERE o.deal_id IS NOT NULL AND o.stripe_checkout_session_id IS NOT NULL
   AND o.billing_environment='live'
 UNION ALL
 SELECT 'billing',o.updated_at,o.id::text,'stripe',
   CASE WHEN o.status='paid' THEN 'paid:'||o.id::text
        WHEN o.status='payment_failed' THEN 'failed:'||o.id::text
        ELSE 'expired:'||o.id::text END,
   CASE WHEN o.status='paid' THEN 'billing.paid_verified'
        WHEN o.status='payment_failed' THEN 'billing.failed'
        ELSE 'checkout.expired' END,
   jsonb_build_object('order_id',o.id::text,'opportunity_id',o.deal_id::text)
 FROM public.crm_billing_orders o
 WHERE o.deal_id IS NOT NULL AND o.billing_environment='live'
   AND o.stripe_checkout_session_id IS NOT NULL
   AND o.status IN ('paid','payment_failed','expired')
   AND (o.status<>'paid' OR o.paid_at IS NOT NULL)
   AND EXISTS(
     SELECT 1 FROM public.crm_stripe_events e
     WHERE e.livemode IS TRUE
       AND e.payload->>'session_id'=o.stripe_checkout_session_id
       AND (
         (o.status='paid' AND e.event_type IN
           ('checkout.session.completed','checkout.session.async_payment_succeeded')
           AND e.payload->>'payment_status'='paid')
         OR (o.status='payment_failed'
             AND e.event_type='checkout.session.async_payment_failed')
         OR (o.status='expired' AND e.event_type='checkout.session.expired')
       ))
 UNION ALL
 SELECT 'mail',e.created_at,e.id::text,'mail',
   'email-sent:'||e.id::text,'mail.sent',
   jsonb_build_object('opportunity_id',e.deal_id::text)
 FROM public.crm_events e WHERE e.event_type='email_sent' AND e.deal_id IS NOT NULL
 UNION ALL
 SELECT 'proposal',p.updated_at,p.id::text,'crm',
   'proposal:'||p.id::text,'proposal.sent',
   jsonb_build_object('opportunity_id',p.deal_id::text)
 FROM public.crm_proposals p
 WHERE p.status='sent' AND p.deal_id IS NOT NULL
   AND length(p.snapshot_sha256)=64 AND p.snapshot_sha256 !~ '[^0-9a-fA-F]'
 UNION ALL
 SELECT 'meeting',e.created_at,e.id::text,'crm',
   'meeting:'||e.id::text,'meeting.scheduled',
   jsonb_build_object('opportunity_id',e.deal_id::text)
 FROM public.crm_events e
 WHERE e.event_type='meeting_scheduled' AND e.deal_id IS NOT NULL
 UNION ALL
 SELECT 'handoff',h.occurred_at,h.id::text,'whatsapp',
   'handoff:'||h.id::text,'conversation.human_takeover',
   jsonb_build_object('conversation_id',h.conversation_id::text)
 FROM public.crm_wa_automation_events h
 WHERE h.conversation_id IS NOT NULL
   AND h.from_mode='sdr_active' AND h.to_mode IN ('human_locked','review')
 UNION ALL
 SELECT 'delivery',greatest(d.created_at,o.paid_at),d.order_id::text,'crm',
   'onboarding:'||d.order_id::text,'onboarding.started',
   jsonb_build_object('order_id',d.order_id::text,'opportunity_id',o.deal_id::text)
 FROM public.crm_delivery_projects d
 JOIN public.crm_billing_orders o ON o.id=d.order_id
 WHERE o.status='paid' AND o.paid_at IS NOT NULL
   AND o.billing_environment='live' AND o.deal_id IS NOT NULL;
REVOKE ALL ON public.automation_commercial_source_feed FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.automation_commercial_source_feed TO service_role;

-- Cursor initialization requires an explicit admin while runtime is OFF.
-- No historic journal entry is implicitly replayed or silently fast-forwarded.
CREATE OR REPLACE FUNCTION public.automation_commercial_init_cursor(
 p_workspace_id uuid,p_actor_id uuid,p_stream text
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE v_anchor timestamptz;
BEGIN
 IF p_stream NOT IN ('intake','checkout','billing','mail','delivery','proposal','meeting','handoff')
 THEN RAISE EXCEPTION 'COMMERCIAL_SOURCE_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspace_members m
   JOIN public.crm_members crm ON crm.user_id=m.user_id
   JOIN public.automation_workspaces w ON w.id=m.workspace_id
   JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
   WHERE m.workspace_id=p_workspace_id AND m.user_id=p_actor_id
     AND m.role='admin' AND w.slug='oryneo-crm'
     AND NOT w.active AND s.mode='disabled' AND s.emergency_stop)
 THEN RAISE EXCEPTION 'COMMERCIAL_CURSOR_INIT_DENIED' USING ERRCODE='42501'; END IF;
 INSERT INTO public.automation_commercial_ingest_cursors
   (workspace_id,stream,last_at,initialized_by)
 VALUES(p_workspace_id,p_stream,clock_timestamp(),p_actor_id)
 ON CONFLICT(workspace_id,stream) DO NOTHING;
 SELECT last_at INTO v_anchor FROM public.automation_commercial_ingest_cursors
  WHERE workspace_id=p_workspace_id AND stream=p_stream;
 RETURN v_anchor;
END $fn$;

-- Bounded, transactional, idempotent shadow polling. The last cursor advances
-- only after the inbox transaction succeeds. A locked cursor serializes workers.
CREATE OR REPLACE FUNCTION public.automation_commercial_shadow_ingest(
 p_workspace_id uuid,p_stream text,p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE c public.automation_commercial_ingest_cursors%ROWTYPE;
 v record;
 v_seen integer:=0;
 v_added integer:=0;
 v_before bigint;
 v_after bigint;
BEGIN
 IF p_stream NOT IN ('intake','checkout','billing','mail','delivery','proposal','meeting','handoff')
   OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
 THEN RAISE EXCEPTION 'COMMERCIAL_INGEST_ARGUMENTS' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(
   SELECT 1 FROM public.automation_workspaces w
    JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
   WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active
     AND s.mode='shadow' AND NOT s.emergency_stop
 ) THEN RAISE EXCEPTION 'COMMERCIAL_SHADOW_ONLY' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.automation_commercial_ingest_cursors
   WHERE workspace_id=p_workspace_id AND stream=p_stream FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COMMERCIAL_CURSOR_REQUIRED' USING ERRCODE='42501'; END IF;
 FOR v IN SELECT f.at_time,f.at_key,f.source,f.event_id,f.event_type,f.context_refs
   FROM public.automation_commercial_source_feed f
   WHERE f.stream=p_stream AND f.at_time IS NOT NULL
     AND (f.at_time,f.at_key)>(c.last_at,c.last_key)
   ORDER BY f.at_time,f.at_key LIMIT p_limit
 LOOP
   SELECT count(*) INTO v_before FROM public.automation_event_inbox
    WHERE workspace_id=p_workspace_id AND source=v.source AND event_id=v.event_id;
   PERFORM public.automation_shadow_ingest(
     p_workspace_id,v.source,v.event_id,v.event_type,v.context_refs);
   SELECT count(*) INTO v_after FROM public.automation_event_inbox
    WHERE workspace_id=p_workspace_id AND source=v.source AND event_id=v.event_id;
   IF v_after=1 AND v_before=0 THEN v_added:=v_added+1; END IF;
   c.last_at:=v.at_time;
   c.last_key:=v.at_key;
   v_seen:=v_seen+1;
 END LOOP;
 IF v_seen>0 THEN
   UPDATE public.automation_commercial_ingest_cursors SET
      last_at=c.last_at,last_key=c.last_key,updated_at=clock_timestamp()
   WHERE workspace_id=p_workspace_id AND stream=p_stream;
 END IF;
 RETURN jsonb_build_object('shadowOnly',true,'dispatchAuthorized',false,
   'source',p_stream,'scanned',v_seen,'inserted',v_added);
END $fn$;
REVOKE ALL ON FUNCTION public.automation_commercial_init_cursor(uuid,uuid,text)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.automation_commercial_shadow_ingest(uuid,text,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_commercial_init_cursor(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.automation_commercial_shadow_ingest(uuid,text,integer) TO service_role;

COMMIT;
