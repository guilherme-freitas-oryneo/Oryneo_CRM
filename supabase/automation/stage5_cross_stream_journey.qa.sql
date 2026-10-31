-- ORYNEO Stage 5 — cross-stream journey acceptance (disposable PostgreSQL17).
-- Executes AFTER commercial_sources.qa.sql. Read-only even in disposable DB.
\set ON_ERROR_STOP on
DO $qa$
DECLARE
  opportunity text:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
  intake_id text:='intake:c0000000-0000-4000-8000-000000000002';
  checkout_id text:='checkout:c1000000-0000-4000-8000-000000000001';
  paid_id text:='paid:c1000000-0000-4000-8000-000000000002';
  onboard_id text:='onboarding:c1000000-0000-4000-8000-000000000002';
  bad_id text:='failed:c1000000-0000-4000-8000-000000000003';
  expired_id text:='expired:c1000000-0000-4000-8000-000000000004';
  id text;
BEGIN
 -- P01/P02: journey stages correlate by immutable canonical opportunity ID.
 FOREACH id IN ARRAY ARRAY[intake_id,checkout_id,paid_id,onboard_id] LOOP
   IF (SELECT count(*) FROM public.automation_event_inbox
      WHERE event_id=id AND context_refs->>'opportunity_id'=opportunity)<>1
   THEN RAISE EXCEPTION 'Stage5 canonical opportunity correlation lost: %',id; END IF;
 END LOOP;
 IF (SELECT context_refs->>'order_id' FROM public.automation_event_inbox
     WHERE event_id=paid_id)
 IS DISTINCT FROM
 (SELECT context_refs->>'order_id' FROM public.automation_event_inbox
     WHERE event_id=onboard_id)
 THEN RAISE EXCEPTION 'Stage5 paid order not linked to same onboarding'; END IF;
 -- P03: request and checkout are never converted to payment evidence by mere intent.
 IF EXISTS(SELECT 1 FROM public.automation_event_inbox
  WHERE event_id='paid:c1000000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'Stage5 pending checkout became a fake payment'; END IF;
 -- P04/P06: verified paid, failed and expired events retain disjoint event types.
 IF NOT EXISTS(SELECT 1 FROM public.automation_event_inbox
   WHERE event_id=paid_id AND source='stripe' AND event_type='billing.paid_verified')
 OR NOT EXISTS(SELECT 1 FROM public.automation_event_inbox
   WHERE event_id=bad_id AND event_type='billing.failed')
 OR NOT EXISTS(SELECT 1 FROM public.automation_event_inbox
   WHERE event_id=expired_id AND event_type='checkout.expired')
 THEN RAISE EXCEPTION 'Stage5 cross-stream financial states were conflated'; END IF;
 -- P05: Meta/Stripe/webhook event keys remain distinct and deduplicated.
 IF EXISTS(SELECT 1 FROM public.automation_event_inbox
   GROUP BY workspace_id,source,event_id HAVING count(*)>1)
 THEN RAISE EXCEPTION 'Stage5 canonical webhook replay duplicated an inbox entry'; END IF;
 -- P08: onboarding starts ONLY for the recorded paid order, not its pending sibling.
 IF EXISTS(SELECT 1 FROM public.automation_event_inbox
   WHERE event_id='onboarding:c1000000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'Stage5 unpaid checkout started onboarding'; END IF;
 -- S12/K03: the inbox contains references, never source payment text or client PII.
 IF EXISTS(SELECT 1 FROM public.automation_event_inbox
   WHERE context_refs ?| ARRAY['message','body','email','customer_wa_id',
     'phone','stripe_payload','api_key','system_prompt','customer_name'])
 THEN RAISE EXCEPTION 'Stage5 source leaked PII or untrusted prompt into engine context'; END IF;
 -- Stage1–4 safety: the synthetic cross-stream journey never sends or bills.
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox
   WHERE state IN ('queued','leased','sent'))
 THEN RAISE EXCEPTION 'Stage5 journey generated provider side effects'; END IF;
END $qa$;
SELECT 'stage5-cross-stream-journey-no-effects-qa-passed' AS qa_result;
