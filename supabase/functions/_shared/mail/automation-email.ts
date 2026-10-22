import { renderImplementationStartedEmail } from './implementation-started-template.ts';
import { renderRequestReceivedEmail, type RequestReceivedEmail, type RequestReceivedInput } from './request-received-template.ts';

export type AutomationEmailType = 'lead_received_email' | 'implementation_started_email';
export const automationDelayMs = 5 * 60 * 1000;

export function parseAutomationEmailType(value: unknown): AutomationEmailType {
  if (value === 'lead_received_email' || value === 'implementation_started_email') return value;
  throw new Error('AUTOMATION_JOB_TYPE_INVALID');
}

export function renderAutomationEmail(type: AutomationEmailType, input: RequestReceivedInput): RequestReceivedEmail {
  return type === 'implementation_started_email'
    ? renderImplementationStartedEmail(input)
    : renderRequestReceivedEmail(input);
}
