/** Sanitized, non-emitting failure reasons for the ORYNEO shadow worker. */
export const SHADOW_FAILURE_CODES = [
 'SHADOW_FLOWS_UNAVAILABLE','SHADOW_FLOW_LIMIT',
 'SHADOW_VERSIONS_UNAVAILABLE','WAIT_CONVERSATION_REQUIRED',
 'WAIT_CANCEL_UNAVAILABLE','SHADOW_ACK_FAILED',
 'SHADOW_CONTEXT_UNAVAILABLE','SHADOW_PLANNER_FAILED',
 'SHADOW_RUNTIME_STOPPED','SHADOW_UNEXPECTED_FAILURE',
] as const;
export type ShadowFailureCode = typeof SHADOW_FAILURE_CODES[number];
const allowed = new Set<string>(SHADOW_FAILURE_CODES);
export function shadowFailureCode(error: unknown): ShadowFailureCode {
 try {
  if (error instanceof Error && allowed.has(error.message))
   return error.message as ShadowFailureCode;
 } catch { /* a hostile getter must not expose the message */ }
 return 'SHADOW_UNEXPECTED_FAILURE';
}
