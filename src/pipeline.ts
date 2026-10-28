import type { Deal, DealRow } from './data';

/** A new negotiation never inherits financial approvals or communication history. */
export function duplicateDealData(row: DealRow, stageId: string): Deal {
  const d = row.data;
  return {
    title: `${d.title.slice(0, 152)} · cópia`, company: d.company, contact: d.contact,
    email: d.email, phone: d.phone, value_cents: d.value_cents, stage_id: stageId,
    company_cnpj: d.company_cnpj, company_profile: d.company_profile ? structuredClone(d.company_profile) : null,
    source: 'Duplicação', duplicated_from: row.id, notes: '', due_date: '',
    next_action: { title: 'Definir próximo passo da nova oportunidade', done: false, due_at: null },
  };
}
export function actionBucket(deal: Deal, now = new Date()): 'overdue'|'scheduled'|'unscheduled'|'done' {
  const action = deal.next_action;
  if (action?.done) return 'done';
  const due = action?.due_at ? new Date(action.due_at) : deal.due_date ? new Date(`${deal.due_date}T23:59:59`) : null;
  if (!due || !Number.isFinite(due.getTime())) return 'unscheduled';
  return due < now ? 'overdue' : 'scheduled';
}
