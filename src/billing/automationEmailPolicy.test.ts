import { describe, expect, it } from 'vitest';
import { parseAutomationEmailType } from '../../supabase/functions/_shared/mail/automation-email';

describe('commercial automation email policy', () => {
  it('accepts only explicitly configured job types from the outbox', () => {
    expect(parseAutomationEmailType('lead_received_email')).toBe('lead_received_email');
    expect(parseAutomationEmailType('implementation_started_email')).toBe('implementation_started_email');
    expect(() => parseAutomationEmailType('unknown')).toThrow('AUTOMATION_JOB_TYPE_INVALID');
    expect(() => parseAutomationEmailType(null)).toThrow('AUTOMATION_JOB_TYPE_INVALID');
  });
});
