import { renderImplementationStartedEmail } from './implementation-started-template.ts';
import { renderRequestReceivedEmail, type RequestReceivedEmail, type RequestReceivedInput } from './request-received-template.ts';

export type AutomationEmailType = 'lead_received_email' | 'implementation_started_email';
export const automationDelayMs = 5 * 60 * 1000;

export function renderAutomationEmail(type: AutomationEmailType, input: RequestReceivedInput): RequestReceivedEmail {
  return type === 'implementation_started_email'
    ? renderImplementationStartedEmail(input)
    : renderRequestReceivedEmail(input);
}
