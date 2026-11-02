-- ORYNEO Stage 6 hosted readiness snapshot. READ ONLY: no customer data,
-- provider payload, message content, credential or mutation is returned.
-- Run with a trusted service operator and archive the single JSON result.
WITH workspace AS (
  SELECT id,slug,active
    FROM public.automation_workspaces
   WHERE slug='oryneo-crm'
   LIMIT 1
)
SELECT jsonb_build_object(
  'workspace',jsonb_build_object('id',w.id,'slug',w.slug,'active',w.active),
  'runtime',(
    SELECT jsonb_build_object('mode',r.mode,'emergencyStop',r.emergency_stop)
      FROM public.automation_runtime_settings r WHERE r.workspace_id=w.id
  ),
  'channelOwners',COALESCE((
    SELECT jsonb_object_agg(o.channel,o.owner ORDER BY o.channel)
      FROM public.automation_channel_ownership o WHERE o.workspace_id=w.id
  ),'{}'::jsonb),
  'activeAttestations',(
    SELECT count(*) FROM public.automation_release_attestations a
     WHERE a.workspace_id=w.id AND a.revoked_at IS NULL
       AND a.expires_at>clock_timestamp()
  ),
  'globalMissingGates',public.automation_release_missing_gates(w.id,NULL),
  'channelMissingGates',(
    SELECT jsonb_object_agg(c.channel,
      public.automation_release_missing_gates(w.id,c.channel) ORDER BY c.channel)
      FROM unnest(ARRAY['billing','crm','email','onboarding','whatsapp']) c(channel)
  ),
  'counts',jsonb_build_object(
    'enabledFlows',(SELECT count(*) FROM public.automation_flows f
      WHERE f.workspace_id=w.id AND f.enabled),
    'publishedVersions',(SELECT count(*) FROM public.automation_flow_versions v
      JOIN public.automation_flows f ON f.id=v.flow_id
      WHERE f.workspace_id=w.id AND v.status='published'),
    'executions',(SELECT count(*) FROM public.automation_executions e
      WHERE e.workspace_id=w.id),
    'liveQueue',(SELECT count(*) FROM public.automation_action_outbox a
      WHERE a.workspace_id=w.id AND a.state IN ('queued','leased')),
    'activeWaits',(SELECT count(*) FROM public.automation_live_waits l
      WHERE l.workspace_id=w.id AND l.state IN ('waiting','leased'))
  ),
  'capturedAt',clock_timestamp()
) AS snapshot
FROM workspace w;
