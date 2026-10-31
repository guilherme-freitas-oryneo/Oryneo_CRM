-- ORYNEO Stage3 CRM adapter: PostgreSQL 17 disposable ONLY.
\set ON_ERROR_STOP on
CREATE TABLE IF NOT EXISTS public.crm_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor uuid NOT NULL,record_id uuid,
 before_data jsonb,before_deleted boolean,after_revision bigint,
 undone boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
-- Match the existing production UUID default; the disposable CRM fixture omitted it.
ALTER TABLE public.crm_events ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.crm_events ADD COLUMN IF NOT EXISTS actor uuid,
 ADD COLUMN IF NOT EXISTS actor_label text,
 ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb;
\i supabase/automation/commercial_data_grants.preview.sql
DO $acl$
BEGIN
 IF NOT has_table_privilege('service_role','public.crm_intake_requests','SELECT')
  OR NOT has_table_privilege('service_role','public.crm_delivery_projects','SELECT')
  OR NOT has_table_privilege('service_role','public.crm_events','SELECT')
  OR NOT has_column_privilege('service_role','public.crm_records','data','UPDATE')
  OR NOT has_column_privilege('service_role','public.crm_records','revision','UPDATE')
  OR NOT has_column_privilege('service_role','public.crm_records','updated_at','UPDATE')
  OR has_column_privilege('service_role','public.crm_records','kind','UPDATE')
  OR has_column_privilege('service_role','public.crm_records','deleted','UPDATE')
  OR has_table_privilege('anon','public.crm_history','SELECT')
  OR has_table_privilege('anon','public.crm_events','INSERT')
 THEN RAISE EXCEPTION 'Stage3 canonical least-privilege grants are incomplete or broadened'; END IF;
END $acl$;
\i supabase/automation/commercial_crm_claim.preview.sql
\i supabase/automation/commercial_crm_stage_adapter.preview.sql
-- Simulation grant ONLY inside disposable PostgreSQL QA (not in migration).
GRANT UPDATE ON public.automation_channel_ownership TO service_role;

BEGIN;
UPDATE public.automation_workspaces SET active=true
 WHERE id='11111111-1111-4111-8111-111111111111';
UPDATE public.automation_runtime_settings SET mode='live',emergency_stop=false
 WHERE workspace_id='11111111-1111-4111-8111-111111111111';
UPDATE public.automation_channel_ownership SET
 owner='new_engine',
 legacy_dispatch_paused_at=clock_timestamp()-interval '2 minutes',
 release_approved_at=clock_timestamp(),
 release_id='qa-only-crm-cutover'
 WHERE workspace_id='11111111-1111-4111-8111-111111111111'
  AND channel='crm';

INSERT INTO public.automation_flows(id,workspace_id,slug,name,kind,enabled)
 VALUES('d1000000-0000-4000-8000-000000000001',
  '11111111-1111-4111-8111-111111111111','qa-crm-stage-atomic',
  'QA crm stage mutation','pipeline',false);
INSERT INTO public.automation_flow_versions(
 id,workspace_id,flow_id,version,schema_version,graph_json,
 content_sha256,status,published_by,published_at)
 VALUES('d1000000-0000-4000-8000-000000000002',
 '11111111-1111-4111-8111-111111111111',
 'd1000000-0000-4000-8000-000000000001',1,'1.0.0',
 '{"nodes":[{"id":"d1000000-0000-4000-8000-000000000006",
  "type":"crm_stage_change","config":{"target_stage_id":"f883a26d-d813-4d09-b807-fa1eb44396f4"}}],"edges":[]}'::jsonb,
 repeat('b',64),'published','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',clock_timestamp());
UPDATE public.automation_flows SET published_version_id='d1000000-0000-4000-8000-000000000002',
 enabled=true WHERE id='d1000000-0000-4000-8000-000000000001';
INSERT INTO public.automation_event_inbox(
 id,workspace_id,source,event_id,event_type,schema_version,context_refs)
 VALUES('d1000000-0000-4000-8000-000000000003',
 '11111111-1111-4111-8111-111111111111','crm',
 'qa.crm.stage.canonical','opportunity.stage_changed','1.0.0',
 '{"opportunity_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01"}');
INSERT INTO public.automation_executions(
 id,workspace_id,flow_version_id,inbox_id,state)
 VALUES('d1000000-0000-4000-8000-000000000004',
 '11111111-1111-4111-8111-111111111111',
 'd1000000-0000-4000-8000-000000000002',
 'd1000000-0000-4000-8000-000000000003','running');
INSERT INTO public.automation_action_outbox(
 id,workspace_id,execution_id,node_id,action_key,action_type,state,due_at)
 VALUES('d1000000-0000-4000-8000-000000000005',
 '11111111-1111-4111-8111-111111111111',
 'd1000000-0000-4000-8000-000000000004',
 'd1000000-0000-4000-8000-000000000006',repeat('e',64),
 'crm_stage_change','queued',clock_timestamp()-interval '1 second');

SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 a uuid:='d1000000-0000-4000-8000-000000000005';
 token uuid;
 r jsonb;
 old_history integer;
 old_events integer;
 old_revision bigint;
 refused boolean;
BEGIN
 SELECT count(*) INTO old_history FROM public.crm_history;
 SELECT count(*) INTO old_events FROM public.crm_events;
 SELECT revision INTO old_revision FROM public.crm_records
 WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
 -- If the legacy executor remains the owner, even a valid DB lease cannot
 -- change a canonical deal. No HTTP request or real CRM is involved.
 SELECT claim_token INTO token FROM public.automation_commercial_claim_crm(w,1)
 WHERE action_id=a;
 IF token IS NULL THEN RAISE EXCEPTION 'CRM stage action not leased'; END IF;
 -- A channel can be returned to the legacy dispatcher AFTER a prior lease;
 -- the CRM action must still revalidate ownership before mutating.
 UPDATE public.automation_channel_ownership SET owner='legacy',
  legacy_dispatch_paused_at=NULL,release_approved_at=NULL,release_id=NULL
 WHERE workspace_id=w AND channel='crm';
 refused:=false;
 BEGIN
  PERFORM public.automation_crm_stage_action(w,a,token,old_revision);
 EXCEPTION WHEN insufficient_privilege THEN refused:=true;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'Legacy owner allowed concurrent CRM stage mutation'; END IF;
 IF (SELECT revision FROM public.crm_records
  WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01')<>old_revision
 THEN RAISE EXCEPTION 'CRM modified during legacy ownership'; END IF;
 UPDATE public.automation_channel_ownership SET owner='new_engine',
  legacy_dispatch_paused_at=clock_timestamp()-interval '2 minutes',
  release_approved_at=clock_timestamp(),release_id='qa-only-crm-cutover'
 WHERE workspace_id=w AND channel='crm';
 refused:=false;
 BEGIN
  PERFORM public.automation_crm_stage_action(w,a,
   'ffffffff-ffff-4fff-8fff-ffffffffffff',old_revision);
 EXCEPTION WHEN insufficient_privilege THEN refused:=true;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'Stale action fencing token allowed'; END IF;
 refused:=false;
 BEGIN
  PERFORM public.automation_crm_stage_action(w,a,token,old_revision+1);
 EXCEPTION WHEN serialization_failure THEN refused:=true;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'Wrong optimistic revision allowed'; END IF;
 r:=public.automation_crm_stage_action(w,a,token,old_revision);
 IF r->>'outcome'<>'stage_changed' OR
  (SELECT revision FROM public.crm_records WHERE id=
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01')<>old_revision+1
 THEN RAISE EXCEPTION 'CRM CAS mutation failed: %',r; END IF;
 IF (SELECT data->>'stage_id' FROM public.crm_records WHERE id=
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01')<>'f883a26d-d813-4d09-b807-fa1eb44396f4'
 THEN RAISE EXCEPTION 'Canonical target stage not applied'; END IF;
 IF (SELECT count(*) FROM public.crm_history)<>old_history+1 OR
   (SELECT count(*) FROM public.crm_events)<>old_events+1
 THEN RAISE EXCEPTION 'Stage change did not preserve audited CRM history'; END IF;
 r:=public.automation_crm_stage_action(w,a,token,old_revision);
 IF r->>'outcome'<>'duplicate_noop'
 THEN RAISE EXCEPTION 'Retry duplicated already-acked CRM change'; END IF;
 IF (SELECT count(*) FROM public.crm_history)<>old_history+1 OR
 (SELECT count(*) FROM public.crm_events)<>old_events+1
 THEN RAISE EXCEPTION 'Duplicate history or stage event'; END IF;
 IF EXISTS(SELECT 1 FROM public.automation_action_outbox
  WHERE workspace_id=w AND action_type='crm_stage_change' AND state<>'sent')
 THEN RAISE EXCEPTION 'CRM claim left incomplete'; END IF;
END $qa$;
RESET ROLE;
ROLLBACK;
DO $security$
BEGIN
 IF has_function_privilege('authenticated',
  'public.automation_crm_stage_action(uuid,uuid,uuid,bigint)','EXECUTE')
 OR has_function_privilege('anon',
  'public.automation_crm_stage_action(uuid,uuid,uuid,bigint)','EXECUTE')
 THEN RAISE EXCEPTION 'CRM action adapter exposed to frontend'; END IF;
END $security$;
SELECT 'stage3-crm-atomic-cas-rollback-no-duplicates-qa-passed' qa_result;
