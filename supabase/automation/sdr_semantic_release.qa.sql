-- Stage4 SDR release acceptance in disposable PostgreSQL17 only.
\set ON_ERROR_STOP on
\i supabase/automation/sdr_semantic_release.preview.sql
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 actor uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 k uuid;
 d uuid;
 dict jsonb;
 response jsonb;
 denied boolean;
 n integer;
BEGIN
 UPDATE public.automation_workspaces SET active=false WHERE id=w;
 UPDATE public.automation_runtime_settings SET mode='disabled',emergency_stop=true WHERE workspace_id=w;
 SELECT id INTO k FROM public.automation_knowledge_release
  WHERE workspace_id=w AND release_version=1 AND status='draft';
 IF k IS NULL THEN RAISE EXCEPTION 'Knowledge draft not present for Stage 4'; END IF;
 -- Seed 18 synthetic dictionary entries with positive/negative cases. Actual
 -- candidate JSON is validated by the Deno test suite and stays unapproved.
 SELECT jsonb_agg(jsonb_build_object(
  'id','intent_'||lpad(i::text,2,'0'),'label','Intent '||i,
  'positive',jsonb_build_array('positive '||i,'example '||i),
  'negative',jsonb_build_array('negative '||i),
  'synonyms',jsonb_build_array('synonym '||i),
  'risk',CASE WHEN i=4 THEN 'human_review' ELSE 'normal' END
 ) ORDER BY i) INTO dict FROM generate_series(1,18) i;
 INSERT INTO public.automation_intent_dictionary(
  workspace_id,release_version,language,status,examples,synonyms,content_sha256)
 VALUES(w,2,'pt_BR','draft',dict,'[]'::jsonb,repeat('a',64))
 RETURNING id INTO d;
 IF (SELECT count(*) FROM public.automation_sdr_active_release
  WHERE workspace_id=w AND NOT enabled AND revision=1)=0
 THEN RAISE EXCEPTION 'Release pointer activated on schema application'; END IF;
 IF has_column_privilege('service_role','public.automation_sdr_active_release','enabled','UPDATE')
 OR has_table_privilege('anon','public.automation_sdr_active_release','SELECT')
 OR has_table_privilege('authenticated','public.automation_sdr_active_release','SELECT')
 THEN RAISE EXCEPTION 'Stage4 release enable switch exposed'; END IF;

 SET CONSTRAINTS ALL IMMEDIATE;
END $qa$;
-- Validate authorization under the same SQL invoker role used by the worker.
SET ROLE service_role;
DO $qa$
DECLARE
 w uuid:='11111111-1111-4111-8111-111111111111';
 actor uuid:='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 k uuid;d uuid;
 r jsonb;
 denied boolean;
BEGIN
 SELECT id INTO k FROM public.automation_knowledge_release
  WHERE workspace_id=w AND release_version=1;
 SELECT id INTO d FROM public.automation_intent_dictionary
  WHERE workspace_id=w AND release_version=2;
 denied:=false;
 BEGIN
  PERFORM public.automation_sdr_publish_pair_disabled(w,
   'ffffffff-ffff-4fff-8fff-ffffffffffff',k,d,1,repeat('a',64));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Unprivileged actor published SDR release'; END IF;
 denied:=false;
 BEGIN
  PERFORM public.automation_sdr_publish_pair_disabled(w,actor,k,d,2,repeat('a',64));
 EXCEPTION WHEN serialization_failure THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale SDR CAS was accepted'; END IF;
 denied:=false;
 BEGIN
  PERFORM public.automation_sdr_publish_pair_disabled(w,actor,k,d,1,repeat('b',64));
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Tampered dictionary digest was accepted'; END IF;
 r:=public.automation_sdr_publish_pair_disabled(w,actor,k,d,1,repeat('a',64));
 IF r->>'publishedDisabled'<>'true' OR r->>'dispatchAuthorized'<>'false'
 THEN RAISE EXCEPTION 'Published release allowed messages: %',r; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_sdr_active_release
  WHERE workspace_id=w AND NOT enabled AND revision=2
   AND knowledge_release_id=k AND dictionary_release_id=d)
 THEN RAISE EXCEPTION 'Published pair missing or activated'; END IF;
 IF (SELECT count(*) FROM public.automation_audit_log
  WHERE workspace_id=w AND action='sdr_pair_published_disabled')<>1
 THEN RAISE EXCEPTION 'SDR release audit missing'; END IF;
 denied:=false;
 BEGIN
  UPDATE public.automation_intent_dictionary
   SET examples='[]'::jsonb WHERE id=d;
 EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Published intent content was mutable'; END IF;
 denied:=false;
 BEGIN
  UPDATE public.automation_knowledge_release SET content_sha256=repeat('0',64) WHERE id=k;
 EXCEPTION WHEN check_violation THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Published playbook was mutable'; END IF;
 r:=public.automation_sdr_select_pair_disabled(w,actor,k,d,2);
 IF r->>'revision'<>'3' THEN RAISE EXCEPTION 'Rollback reselect CAS revision mismatch'; END IF;
 denied:=false;
 BEGIN
  PERFORM public.automation_sdr_select_pair_disabled(w,actor,k,d,2);
 EXCEPTION WHEN serialization_failure THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Stale rollback pointer mutated releases'; END IF;
 UPDATE public.automation_runtime_settings SET emergency_stop=false WHERE workspace_id=w;
 denied:=false;
 BEGIN
  PERFORM public.automation_sdr_select_pair_disabled(w,actor,k,d,3);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'Emergency-stop bypassed during SDR rollback'; END IF;
 UPDATE public.automation_runtime_settings SET emergency_stop=true WHERE workspace_id=w;
 IF EXISTS(SELECT 1 FROM public.automation_sdr_active_release WHERE enabled)
 OR EXISTS(SELECT 1 FROM public.automation_action_outbox
  WHERE state IN ('queued','leased','sent'))
 THEN RAISE EXCEPTION 'SDR release generated live work'; END IF;
END $qa$;
RESET ROLE;
SELECT 'stage4-sdr-release-fenced-immutable-cas-qa-passed' AS qa;
