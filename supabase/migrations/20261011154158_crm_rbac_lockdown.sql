-- Apply only after the CRM frontend uses scoped RPC reads.
drop trigger crm_block_member_add_until_lockdown on public.crm_members;
drop function private.crm_block_member_add_until_lockdown();
drop policy member_records on public.crm_records;
create policy crm_records_scope on public.crm_records for select to authenticated
using (kind='stage' and private.crm_role() is not null
  or kind='deal' and (private.crm_role()='admin' or
    private.crm_role() is not null and owner_user_id=auth.uid()));
drop policy crm_events_members_read on public.crm_events;
create policy crm_events_scope on public.crm_events for select to authenticated
using (exists(select 1 from public.crm_records r where r.id=deal_id and
  (private.crm_role()='admin' or r.owner_user_id=auth.uid() and private.crm_role() is not null)));
drop policy crm_companies_members_read on public.crm_companies;
drop policy own_history on public.crm_history;
create policy crm_history_active_actor on public.crm_history for select to authenticated
using (actor=auth.uid() and private.crm_role() is not null);
revoke select on public.crm_records,public.crm_events,public.crm_companies,public.crm_history
 from anon,authenticated;
