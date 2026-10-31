-- Disposable DB test of draft-only RPCs and optimistic concurrency.
\set ON_ERROR_STOP on

-- Production already has crm_members; disposable schema fixture needs only user_id.
CREATE TABLE IF NOT EXISTS public.crm_members(user_id uuid PRIMARY KEY);
INSERT INTO public.crm_members(user_id) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
GRANT SELECT ON public.crm_members TO service_role;

SET ROLE service_role;

DO $$
DECLARE
  v_id uuid := '44444444-4444-4444-8444-444444444444';
  v_a uuid := '11111111-1111-4111-8111-111111111111';
  v_b uuid := '22222222-2222-4222-8222-222222222222';
  v_actor uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_viewer uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_graph jsonb;
  v_result jsonb;
  v_conflict boolean := false;
  v_denied boolean := false;
BEGIN
  v_graph:=jsonb_build_object(
    'id',v_id,'name','Teste de fluxo','kind','pipeline','status','draft',
    'schema_version','0.1-concept','version',1,
    'nodes',jsonb_build_array(
      jsonb_build_object('id','start','type','trigger','config',jsonb_build_object('event_type','opportunity.created'),'ports',jsonb_build_array('out')),
      jsonb_build_object('id','end','type','end','config','{}'::jsonb,'ports',jsonb_build_array('in'))),
    'edges',jsonb_build_array(jsonb_build_object('id','edge-1','source','start','source_port','out','target','end','target_port','in')));
  SELECT public.automation_draft_create(v_a,v_actor,v_graph) INTO v_result;
  IF v_result->>'revision'<>'1' THEN RAISE EXCEPTION 'Wrong draft create revision'; END IF;
  IF (SELECT count(*) FROM public.automation_flow_versions WHERE flow_id=v_id)<>1 THEN
    RAISE EXCEPTION 'Missing initial version'; END IF;
  SELECT public.automation_draft_save(v_a,v_actor,v_id,1,v_graph||'{"name":"Teste atualizado"}'::jsonb) INTO v_result;
  IF v_result->>'revision'<>'2' THEN RAISE EXCEPTION 'Revision CAS did not advance'; END IF;
  BEGIN
    PERFORM public.automation_draft_save(v_a,v_actor,v_id,1,v_graph);
  EXCEPTION WHEN serialization_failure THEN v_conflict:=true;
  END;
  IF NOT v_conflict THEN RAISE EXCEPTION 'Missing stale draft conflict'; END IF;

  BEGIN
    PERFORM public.automation_draft_create(v_b,v_actor,v_graph||'{"id":"55555555-5555-4555-8555-555555555555"}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Cross-tenant create accepted'; END IF;
  v_denied := false;
  BEGIN
    PERFORM public.automation_draft_create(v_b,v_viewer,v_graph||'{"id":"66666666-6666-4666-8666-666666666666"}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN v_denied:=true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Viewer can edit'; END IF;
  IF (SELECT count(*) FROM public.automation_audit_log WHERE target_id=v_id)<>2 THEN
    RAISE EXCEPTION 'Audit history missing'; END IF;
  IF (SELECT count(*) FROM public.automation_runtime_settings WHERE mode='live' OR emergency_stop=false)<>0 THEN
    RAISE EXCEPTION 'Draft API changed runtime switches'; END IF;
END; $$;
RESET ROLE;
SELECT 'automation-draft-rpcs-qa-passed' AS qa_result;
