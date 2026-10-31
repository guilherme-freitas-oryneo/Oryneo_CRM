-- Disposable PostgreSQL only. Executed after publication.qa.sql.
\set ON_ERROR_STOP on
SET ROLE service_role;
DO $$
DECLARE
  w uuid:='11111111-1111-4111-8111-111111111111';
  e uuid;
  again uuid;
  first_claim record;
  second_claim record;
  v_version uuid;
  plans jsonb;
  outcome jsonb;
  denied boolean:=false;
BEGIN
  -- A disabled workspace cannot receive events from the new engine.
  BEGIN
    PERFORM public.automation_shadow_ingest(w,'crm','evt.test','opportunity.created','{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Disabled runtime ingested event'; END IF;
  UPDATE public.automation_workspaces SET active=true WHERE id=w;
  UPDATE public.automation_runtime_settings SET mode='shadow',emergency_stop=false WHERE workspace_id=w;

  e:=public.automation_shadow_ingest(w,'crm','evt.test','opportunity.created',
    '{"opportunity_id":"44444444-4444-4444-8444-444444444444"}'::jsonb);
  again:=public.automation_shadow_ingest(w,'crm','evt.test','opportunity.created',
    '{"opportunity_id":"44444444-4444-4444-8444-444444444444"}'::jsonb);
  IF e IS NULL OR again IS DISTINCT FROM e THEN
    RAISE EXCEPTION 'Idempotent inbox key not reused'; END IF;
  denied:=false;
  BEGIN
    PERFORM public.automation_shadow_ingest(w,'crm','evt.bad','opportunity.created',
      '{"extra_field":"untrusted"}'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Event accepted arbitrary contextual fields'; END IF;

  SELECT * INTO first_claim FROM public.automation_shadow_claim(w,1);
  IF NOT FOUND OR first_claim.inbox_id IS DISTINCT FROM e OR first_claim.attempt<>1 THEN
    RAISE EXCEPTION 'First worker did not claim the event'; END IF;
  SELECT * INTO second_claim FROM public.automation_shadow_claim(w,1);
  IF FOUND THEN RAISE EXCEPTION 'Two workers claimed the same unexpired lease'; END IF;

  -- A stale worker loses ownership, even if the logical event is identical.
  UPDATE public.automation_event_inbox SET lease_until=now()-interval '1 second' WHERE id=e;
  SELECT * INTO second_claim FROM public.automation_shadow_claim(w,1);
  IF NOT FOUND OR second_claim.attempt<>2
    OR second_claim.lease_token=first_claim.lease_token THEN
    RAISE EXCEPTION 'Lease recovery failed'; END IF;
  denied:=false;
  BEGIN
    PERFORM public.automation_shadow_finish(w,e,first_claim.lease_token,'[]'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Stale worker acknowledged event'; END IF;

  SELECT published_version_id INTO v_version FROM public.automation_flows
    WHERE id='44444444-4444-4444-8444-444444444444';
  IF v_version IS NULL THEN RAISE EXCEPTION 'Published fixture missing'; END IF;
  plans:=jsonb_build_array(jsonb_build_object(
    'flowVersionId',v_version,
    'decision',jsonb_build_object(
      'shadowOnly',true,'dispatchAuthorized',false,'state','completed',
      'activationKey',repeat('a',64),
      'trace',jsonb_build_array(
        jsonb_build_object('nodeId','77777777-7777-4777-8777-777777777777',
          'type','trigger','status','evaluated'),
        jsonb_build_object('nodeId','88888888-8888-4888-8888-888888888888',
          'type','end','status','completed')),
      'plannedActions','[]'::jsonb,'issues','[]'::jsonb)));
  denied:=false;
  BEGIN
    PERFORM public.automation_shadow_finish(w,e,second_claim.lease_token,'[]'::jsonb);
  EXCEPTION WHEN invalid_parameter_value THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'A matching published flow was omitted'; END IF;

  outcome:=public.automation_shadow_finish(w,e,second_claim.lease_token,plans);
  IF outcome->>'shadowOnly'<>'true'
    OR outcome->>'dispatchAuthorized'<>'false' OR outcome->>'flowCount'<>'1'
  THEN RAISE EXCEPTION 'Shadow acknowledgement mismatch'; END IF;
  IF (SELECT state FROM public.automation_event_inbox WHERE id=e)<>'processed'
    OR (SELECT count(*) FROM public.automation_executions WHERE inbox_id=e)<>1
    OR (SELECT count(*) FROM public.automation_node_executions
        WHERE execution_id IN(SELECT id FROM public.automation_executions WHERE inbox_id=e))<>2
  THEN RAISE EXCEPTION 'Missing durable trace or completion'; END IF;
  IF EXISTS(SELECT 1 FROM public.automation_action_outbox WHERE state<>'blocked')
  THEN RAISE EXCEPTION 'Shadow scheduled a real action'; END IF;
  denied:=false;
  BEGIN
    PERFORM public.automation_shadow_finish(w,e,second_claim.lease_token,plans);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Processed event acknowledged twice'; END IF;

  -- Recovery turns exhausted expired leases into an auditable failed state.
  again:=public.automation_shadow_ingest(w,'crm','evt.exhausted','opportunity.created','{}'::jsonb);
  UPDATE public.automation_event_inbox SET attempts=5,lease_until=now()-interval '1 second'
    WHERE id=again;
  IF public.automation_shadow_recover(w)<>1
    OR (SELECT state FROM public.automation_event_inbox WHERE id=again)<>'failed'
  THEN RAISE EXCEPTION 'Exhausted retry was not quarantined'; END IF;
  -- Restore safe defaults before ending even in disposable fixture.
  UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
  UPDATE public.automation_workspaces SET active=false WHERE id=w;
END; $$;
RESET ROLE;
SELECT 'automation-shadow-queue-qa-passed' AS qa_result;
