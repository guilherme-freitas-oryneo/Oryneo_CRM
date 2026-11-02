import type { MailboxAddress } from './mime.ts';
import { renderAutomationEmail, type AutomationEmailType } from './automation-email.ts';

export type IntakeConfirmationJob = {
  requestId: string;
  dealId: string;
  orderId: string | null;
  data: Record<string, unknown>;
  jobType: AutomationEmailType;
};

export type IntakeConfirmationSendInput = {
  idempotencyKey: string;
  to: MailboxAddress[];
  subject: string;
  text: string;
  html: string;
};

export type IntakeConfirmationDependencies = {
  claimDue(limit: number): Promise<IntakeConfirmationJob[]>;
  isImplementationStillPaid?(orderId: string, dealId: string): Promise<boolean>;
  send(input: IntakeConfirmationSendInput): Promise<{ internetMessageId: string; alreadyAccepted: boolean }>;
  markSent(requestId: string, internetMessageId: string): Promise<void>;
  markFailed(requestId: string, errorCode: string): Promise<void>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function errorCode(reason: unknown): string {
  const value = reason instanceof Error ? reason.message : '';
  if (value === 'MAIL_IN_PROGRESS') return value;
  if (value === 'INTAKE_CONFIRMATION_INVALID') return value;
  if (value === 'IMPLEMENTATION_ORDER_INVALID') return value;
  if (value === 'IMPLEMENTATION_PAYMENT_REVOKED') return value;
  return 'INTAKE_CONFIRMATION_SEND';
}

export function intakeConfirmationStateForError(errorCode: string): 'failed' | 'reconciliation' | 'suppressed' {
  if (errorCode === 'MAIL_IN_PROGRESS') return 'reconciliation';
  if (errorCode === 'INTAKE_CONFIRMATION_INVALID') return 'suppressed';
  if (errorCode === 'IMPLEMENTATION_ORDER_INVALID') return 'suppressed';
  if (errorCode === 'IMPLEMENTATION_PAYMENT_REVOKED') return 'suppressed';
  return 'failed';
}

export async function processIntakeConfirmationJobs(
  dependencies: IntakeConfirmationDependencies,
  limit = 10,
): Promise<{ claimed: number; sent: number; failed: number }> {
  const jobs = await dependencies.claimDue(Math.min(Math.max(limit, 1), 25));
  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    try {
      const contact = text(job.data.contact);
      const company = text(job.data.company);
      const email = text(job.data.email).toLowerCase();
      if (!UUID.test(job.requestId) || !UUID.test(job.dealId) || !contact || !company || !EMAIL.test(email) || /[\r\n\0]/.test(email)) {
        throw new Error('INTAKE_CONFIRMATION_INVALID');
      }
      if (job.jobType === 'implementation_started_email' && (!job.orderId || !UUID.test(job.orderId))) {
        throw new Error('IMPLEMENTATION_ORDER_INVALID');
      }
      const rendered = renderAutomationEmail(job.jobType, { firstName: contact.split(/\s+/)[0], company });
      if (job.jobType === 'implementation_started_email') {
        // Recheck the exact order immediately before the external side effect.
        // Missing verifier fails closed.
        if (!dependencies.isImplementationStillPaid ||
          !await dependencies.isImplementationStillPaid(job.orderId!, job.dealId)) {
          throw new Error('IMPLEMENTATION_PAYMENT_REVOKED');
        }
      }
      const result = await dependencies.send({
        idempotencyKey: job.requestId,
        to: [{ name: contact, address: email }],
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
      await dependencies.markSent(job.requestId, result.internetMessageId);
      sent += 1;
    } catch (reason) {
      await dependencies.markFailed(job.requestId, errorCode(reason));
      failed += 1;
    }
  }
  return { claimed: jobs.length, sent, failed };
}
