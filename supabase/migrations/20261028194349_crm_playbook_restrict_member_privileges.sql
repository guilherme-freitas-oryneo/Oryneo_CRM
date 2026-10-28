-- ORYNEO Playbook: remove automatically inherited excessive database permissions.
revoke all on table public.crm_playbook_annotations from authenticated;
revoke all on table public.crm_playbook_progress from authenticated;
grant select, insert, update, delete on table public.crm_playbook_annotations to authenticated;
grant select, insert, update, delete on table public.crm_playbook_progress to authenticated;
revoke all on table public.crm_playbook_annotations from anon, public;
revoke all on table public.crm_playbook_progress from anon, public;
