/**
 * Pure invocation gate for the isolated ORYNEO shadow worker.
 * This file does not read secrets, send messages or call the database.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
export type WorkerEnvironment = {
  enabled: boolean;
  projectUrl: string;
  serviceRole: string;
  workspaceId: string;
  workerSecret: string;
};
export function workerIsConfigured(environment: WorkerEnvironment): boolean {
  if (!environment.enabled || !isCanonicalUuid(environment.workspaceId)) return false;
  if (environment.workerSecret.length < 32 || !environment.serviceRole) return false;
  try {
    const url = new URL(environment.projectUrl);
    return url.protocol === 'https:' && url.hostname.endsWith('.supabase.co');
  } catch {
    return false;
  }
}
/**
 * Compare the entire secret without early exit after a differing character.
 * A caller still needs platform-level JWT verification and an explicit DB gate.
 */
export function validWorkerToken(supplied: string, expected: string): boolean {
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  }
  return diff === 0;
}
