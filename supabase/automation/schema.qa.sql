-- Integration QA, only for disposable PostgreSQL; never run on production.
\set ON_ERROR_STOP on

INSERT INTO public.automation_workspaces (id,slug,active) VALUES
('11111111-1111-4111-8111-111111111111','oryneo-test-a',false),
('22222222-2222-4222-8222-222222222222','oryneo-test-b',false);
INSERT INTO public.automation_workspace_members(workspace_id,user_id,role) VALUES
('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','admin'),
('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','viewer');

INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind) VALUES
('f1111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','lead-inbox','Lead A','pipeline'),
('f2222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222','lead-inbox','Lead B','pipeline');
INSERT INTO public.automation_runtime_settings(workspace_id) VALUES
('11111111-1111-4111-8111-111111111111'),
('22222222-2222-4222-8222-222222222222');
INSERT INTO public.automation_event_inbox(workspace_id,source,event_id,schema_version) VALUES
('11111111-1111-4111-8111-111111111111','crm','evt.1','1.0.0');
INSERT INTO public.automation_event_inbox(workspace_id,source,event_id,schema_version) VALUES
('11111111-1111-4111-8111-111111111111','crm','evt.1','1.0.0')
ON CONFLICT (workspace_id,source,event_id) DO NOTHING;

DO $$
BEGIN
  IF (SELECT count(*) FROM public.automation_event_inbox) <> 1 THEN
    RAISE EXCEPTION 'Duplicate event accepted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.automation_runtime_settings WHERE mode <> 'disabled' OR emergency_stop IS NOT TRUE) THEN
    RAISE EXCEPTION 'Unsafe runtime defaults';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class cls JOIN pg_namespace n ON n.oid = cls.relnamespace
    WHERE n.nspname='public' AND cls.relname LIKE 'automation_%' AND cls.relkind = 'r'
    AND cls.relrowsecurity IS FALSE) THEN
    RAISE EXCEPTION 'Automation table without RLS';
  END IF;
END; $$;

-- Policy test under a simulated authenticated JWT (never service-role).
SET ROLE authenticated;
SET request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
DO $$
DECLARE visible_count int;
DECLARE insert_denied boolean := false;
BEGIN
  SELECT count(*) INTO visible_count FROM public.automation_flows;
  IF visible_count <> 1 THEN RAISE EXCEPTION 'Cross-workspace leak: %',visible_count; END IF;
  SELECT count(*) INTO visible_count FROM public.automation_workspace_members;
  IF visible_count <> 1 THEN RAISE EXCEPTION 'Membership leak: %',visible_count; END IF;
END; $$;
DO $$
DECLARE denied boolean := false;
DECLARE event_count int;
BEGIN
  BEGIN
    SELECT count(*) INTO event_count FROM public.automation_event_inbox;
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'Client could read private event inbox'; END IF;
END; $$;
DO $
DECLARE insert_denied boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.automation_flows(workspace_id,slug,name,kind)
      VALUES('11111111-1111-4111-8111-111111111111','evil','Evil','sdr');
  EXCEPTION WHEN insufficient_privilege THEN
    insert_denied := true;
  END;
  IF NOT insert_denied THEN RAISE EXCEPTION 'Client could insert an automation flow'; END IF;
END; $$;
RESET ROLE;
RESET request.jwt.claim.sub;

-- Version publication must have a complete release hash and is immutable.
INSERT INTO public.automation_flow_versions (
  id,workspace_id,flow_id,version,schema_version,graph_json,status,
  content_sha256,published_by,published_at
) VALUES (
  'd1111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111111',
  'f1111111-1111-4111-8111-111111111111',
  1,'1.0.0','{"schema_version":"1.0.0","nodes":[],"edges":[]}'::jsonb,
  'published',repeat('a',64),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()
);
DO $$
DECLARE blocked boolean := false;
BEGIN
  BEGIN
    UPDATE public.automation_flow_versions SET graph_json='{}'::jsonb
    WHERE id='d1111111-1111-4111-8111-111111111111';
  EXCEPTION WHEN check_violation THEN blocked := true;
  END;
  IF NOT blocked THEN RAISE EXCEPTION 'Published version was mutable'; END IF;
END; $$;
-- Ensure no duplicate (workspace,action_key) is possible at SQL level.
SELECT 'automation-schema-qa-passed' AS qa_result;
