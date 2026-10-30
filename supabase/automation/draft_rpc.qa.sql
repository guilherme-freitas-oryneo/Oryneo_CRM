-- Run AFTER schema.preview.sql + schema.qa.sql + draft_rpc.preview.sql.
-- Disposable PostgreSQL only; all fixture users and workspaces are synthetic.
\set ON_ERROR_STOP on

UPDATE public.automation_workspaces SET active=true
WHERE id IN ('11111111-1111-4111-8111-111111111111',
             '22222222-2222-4222-8222-222222222222');

-- A draft from an explicitly authorized admin gets an atomic version.
SET ROLE service_role;
SELECT * FROM public.automation_save_draft(
  '11111111-1111-4111-8111-111111111111'::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'b1111111-1111-4111-8111-111111111111'::uuid,
  0, 'Diagnóstico SDR', 'sdr',
  '{"schema_version":"0.1-concept","id":"b1111111-1111-4111-8111-111111111111","name":"Diagnóstico SDR","kind":"sdr","status":"draft","version":1,"nodes":[],"edges":[]}'::jsonb
);

SELECT * FROM public.automation_save_draft(
  '11111111-1111-4111-8111-111111111111'::uuid,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'b1111111-1111-4111-8111-111111111111'::uuid,
  1, 'Diagnóstico SDR v2', 'sdr',
  '{"schema_version":"0.1-concept","id":"b1111111-1111-4111-8111-111111111111","name":"Diagnóstico SDR v2","kind":"sdr","status":"draft","version":2,"nodes":[],"edges":[]}'::jsonb
);

DO $$
DECLARE conflict_denied boolean := false;
DECLARE viewer_denied boolean := false;
DECLARE malformed_denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.automation_save_draft(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'b1111111-1111-4111-8111-111111111111',
      1, 'Stale overwrite', 'sdr',
      '{"schema_version":"0.1-concept","id":"b1111111-1111-4111-8111-111111111111","name":"Stale overwrite","kind":"sdr","status":"draft","version":3,"nodes":[],"edges":[]}'::jsonb
    );
  EXCEPTION WHEN serialization_failure THEN conflict_denied := true;
  END;
  IF NOT conflict_denied THEN RAISE EXCEPTION 'Stale write was accepted'; END IF;

  BEGIN
    PERFORM public.automation_save_draft(
      '22222222-2222-4222-8222-222222222222',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'b2222222-2222-4222-8222-222222222222',
      0, 'Viewer cannot edit', 'pipeline',
      '{"schema_version":"0.1-concept","id":"b2222222-2222-4222-8222-222222222222","name":"Viewer cannot edit","kind":"pipeline","status":"draft","version":1,"nodes":[],"edges":[]}'::jsonb
    );
  EXCEPTION WHEN insufficient_privilege THEN viewer_denied := true;
  END;
  IF NOT viewer_denied THEN RAISE EXCEPTION 'Viewer wrote a draft'; END IF;

  BEGIN
    PERFORM public.automation_save_draft(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'b3333333-3333-4333-8333-333333333333',
      0, 'Unpublished', 'pipeline',
      '{"schema_version":"1.0.0","id":"b3333333-3333-4333-8333-333333333333","name":"Unpublished","kind":"pipeline","status":"published","version":1,"nodes":[],"edges":[]}'::jsonb
    );
  EXCEPTION WHEN invalid_parameter_value THEN malformed_denied := true;
  END;
  IF NOT malformed_denied THEN RAISE EXCEPTION 'Untrusted published graph was accepted as draft'; END IF;

  IF (SELECT count(*) FROM public.automation_flow_versions
      WHERE flow_id='b1111111-1111-4111-8111-111111111111') <> 2
    OR (SELECT revision FROM public.automation_flows
        WHERE id='b1111111-1111-4111-8111-111111111111') <> 2
    OR (SELECT count(*) FROM public.automation_audit_log
        WHERE target_id='b1111111-1111-4111-8111-111111111111') <> 2
    OR EXISTS (SELECT 1 FROM public.automation_flows
        WHERE id='b1111111-1111-4111-8111-111111111111' AND enabled IS TRUE)
  THEN
    RAISE EXCEPTION 'Atomic draft revision/audit contract violated';
  END IF;
END $$;
RESET ROLE;

-- Authenticated clients may read their own workspace rows via RLS,
-- but must never invoke the privileged draft mutation directly.
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    PERFORM public.automation_save_draft(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'b1111111-1111-4111-8111-111111111111',2,
      'Direct browser write', 'sdr', '{}'::jsonb
    );
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Browser role could invoke privileged draft RPC'; END IF;
END $$;
RESET ROLE;
RESET request.jwt.claim.sub;

SELECT 'automation-draft-rpc-qa-passed' AS qa_result;
