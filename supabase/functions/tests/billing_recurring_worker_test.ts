import { assertEquals } from 'jsr:@std/assert@1';
import { nextAssistedPaymentSchedule, workerEnvironmentStatus } from '../billing-recurring-worker/index.ts';

Deno.test('Pix assistido agenda a cobrança e os lembretes por competência', () => {
  assertEquals(
    nextAssistedPaymentSchedule('pix_assisted', '2026-11-10T12:00:00.000Z'),
    [
      { job_type: 'pix_due_email', occurrence_key: 'due-7d', due_at: '2026-11-03T12:00:00.000Z' },
      { job_type: 'assisted_payment_reminder_email', occurrence_key: 'due-3d', due_at: '2026-11-07T12:00:00.000Z' },
      { job_type: 'assisted_payment_reminder_email', occurrence_key: 'due-0d', due_at: '2026-11-10T12:00:00.000Z' },
      { job_type: 'assisted_payment_reminder_email', occurrence_key: 'overdue-1d', due_at: '2026-11-11T12:00:00.000Z' },
      { job_type: 'assisted_payment_reminder_email', occurrence_key: 'overdue-3d', due_at: '2026-11-13T12:00:00.000Z' },
      { job_type: 'financial_review_required', occurrence_key: 'overdue-5d', due_at: '2026-11-15T12:00:00.000Z' },
    ],
  );
});

Deno.test('boleto usa a mesma agenda sem se apresentar como Pix', () => {
  const schedule = nextAssistedPaymentSchedule('boleto_assisted', '2026-01-08T00:00:00.000Z');
  assertEquals(schedule[0].job_type, 'assisted_payment_reminder_email');
  assertEquals(schedule.at(-1)?.job_type, 'financial_review_required');
});

Deno.test('o worker recusa LIVE antes de ler configuração Stripe', () => {
  assertEquals(workerEnvironmentStatus('live'), 'LIVE_NOT_ENABLED');
  assertEquals(workerEnvironmentStatus('test'), 'test');
  assertEquals(workerEnvironmentStatus(undefined), 'WORKER_ENVIRONMENT_NOT_CONFIGURED');
});
