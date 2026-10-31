-- Macro 3: claim exclusively CRM-owned effects. PREVIEW, never deployed.
-- Does NOT claim Meta/email/Stripe actions or call external transports.
BEGIN;
CREATE OR REPLACE FUNCTION public.automation_commercial_claim_crm(
 p_workspace_id uuid,p_limit integer DEFAULT 3
) RETURNS TABLE(
 action_id uuid,claim_token uuid,action_key text,action_type text,
 expected_deal_revision bigint
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $fn$
BEGIN
 IF p_workspace_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 5
 THEN RAISE EXCEPTION 'COMMERCIAL_CLAIM_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.automation_workspaces w
  JOIN public.automation_runtime_settings s ON s.workspace_id=w.id
  JOIN public.automation_channel_ownership own ON own.workspace_id=w.id
  WHERE w.id=p_workspace_id AND w.slug='oryneo-crm' AND w.active
    AND s.mode='live' AND s.emergency_stop IS FALSE
    AND own.channel='crm' AND own.owner='new_engine'
    AND own.legacy_dispatch_paused_at IS NOT NULL
    AND own.release_approved_at IS NOT NULL)
 THEN RETURN; END IF;
 RETURN QUERY
 WITH candidate AS(
   SELECT a.id,d.revision AS expected_revision
   FROM public.automation_action_outbox a
   JOIN public.automation_executions e ON e.id=a.execution_id
     AND e.workspace_id=a.workspace_id AND e.state='running'
   JOIN public.automation_event_inbox i ON i.id=e.inbox_id
     AND i.workspace_id=a.workspace_id
   JOIN public.automation_flow_versions v ON v.id=e.flow_version_id
     AND v.workspace_id=a.workspace_id AND v.status='published'
   JOIN public.automation_flows f ON f.id=v.flow_id
     AND f.workspace_id=v.workspace_id AND f.enabled
     AND f.published_version_id=v.id
   JOIN public.crm_records d ON d.id=CASE WHEN
     i.context_refs->>'opportunity_id' ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     THEN (i.context_refs->>'opportunity_id')::uuid ELSE NULL END
     AND d.kind='deal' AND NOT d.deleted
   WHERE a.workspace_id=p_workspace_id AND a.state='queued'
     AND a.action_type IN ('crm_stage_change','crm_task')
     AND (a.due_at IS NULL OR a.due_at<=clock_timestamp())
     AND a.attempts<3
     AND jsonb_typeof(v.graph_json->'nodes')='array'
     AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.graph_json->'nodes') n
       WHERE n->>'id'=a.node_id AND n->>'type'=a.action_type)
   ORDER BY a.due_at NULLS FIRST,a.created_at,a.id LIMIT p_limit
   FOR UPDATE OF a SKIP LOCKED
 ), leased AS(
   UPDATE public.automation_action_outbox a
   SET state='leased',claim_token=gen_random_uuid(),
     attempts=a.attempts+1,claimed_at=clock_timestamp(),
     lease_until=clock_timestamp()+interval '90 seconds'
   FROM candidate c WHERE a.id=c.id
   RETURNING a.id,a.claim_token,a.action_key,a.action_type
 )
 SELECT l.id,l.claim_token,l.action_key,l.action_type,c.expected_revision
 FROM leased l JOIN candidate c ON c.id=l.id;
END $fn$;
REVOKE ALL ON FUNCTION public.automation_commercial_claim_crm(uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_commercial_claim_crm(uuid,integer)
 TO service_role;
COMMIT;
