-- ORYNEO action-outbox runtime safety interlock.
-- No provider connector or dispatcher is installed by this migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.automation_outbox_prevent_premature_queue()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $$
BEGIN
  IF NEW.state IN ('queued','leased') THEN
    IF NOT EXISTS(
      SELECT 1 FROM public.automation_runtime_settings s
      JOIN public.automation_workspaces w ON w.id=s.workspace_id
      WHERE w.id=NEW.workspace_id AND w.active
        AND s.mode='live' AND s.emergency_stop=false
    ) THEN
      RAISE EXCEPTION 'AUTOMATION_OUTBOX_RUNTIME_STOPPED' USING ERRCODE='42501';
    END IF;
    IF NEW.state='leased' AND (NEW.lease_until IS NULL OR NEW.lease_until<=clock_timestamp())
    THEN RAISE EXCEPTION 'AUTOMATION_ACTION_LEASE_INVALID' USING ERRCODE='22023'; END IF;
  END IF;
  -- Historical provider acknowledgements must remain reconcilable
  -- if the emergency switch is pulled after an actual send.
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.automation_outbox_prevent_premature_queue()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.automation_outbox_prevent_premature_queue() TO service_role;
DROP TRIGGER IF EXISTS automation_outbox_runtime_gate ON public.automation_action_outbox;
CREATE TRIGGER automation_outbox_runtime_gate
  BEFORE INSERT OR UPDATE ON public.automation_action_outbox
  FOR EACH ROW EXECUTE FUNCTION public.automation_outbox_prevent_premature_queue();
COMMIT;
