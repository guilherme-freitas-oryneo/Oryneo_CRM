/**
 * Optional remote draft store. DO NOT call until the automation-drafts Edge API,
 * workspace grants and versioned tables are available and audited.
 * The current working SDR uses a separate, unchanged runtime.
 */
import { supabase } from '../data';
import type { FlowDefinition, FlowKind } from './flowDefinition';

export type AutomationWorkspace = {
  id: string;
  slug: string;
  role: 'viewer' | 'editor' | 'publisher' | 'admin';
};
export type AutomationFlowSummary = {
  id: string; slug: string; name: string; kind: FlowKind;
  enabled: boolean; revision: number; published_version_id: string | null;
  updated_at: string;
};
export type AutomationStoredDraft = {
  id: string; version: number; schema_version: string;
  graph_json: FlowDefinition; created_at: string;
};
type ApiResponse = { ok: boolean; error?: string };
const isRecord = (data: unknown): data is Record<string, unknown> =>
  data !== null && typeof data === 'object' && !Array.isArray(data);

async function invokeDrafts<T extends ApiResponse>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('automation-drafts', { body });
  if (error) throw new Error('API_AUTOMATION_DRAFTS_UNAVAILABLE');
  if (!isRecord(data) || data.ok !== true) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'INVALID_AUTOMATIONS_RESPONSE');
  }
  return data as T;
}
export async function listAutomationWorkspaces(): Promise<AutomationWorkspace[]> {
  const response = await invokeDrafts<ApiResponse & { workspaces: AutomationWorkspace[] }>({ action: 'workspaces' });
  return Array.isArray(response.workspaces) ? response.workspaces : [];
}
export async function listAutomationFlows(workspaceId: string):
  Promise<{ flows: AutomationFlowSummary[]; canEdit: boolean }> {
  const response = await invokeDrafts<ApiResponse & {
    flows: AutomationFlowSummary[]; canEdit: boolean;
  }>({ action: 'list', workspaceId });
  return { flows: Array.isArray(response.flows) ? response.flows : [], canEdit: response.canEdit === true };
}
export async function getAutomationDraft(workspaceId: string, flowId: string):
  Promise<{ flow: AutomationFlowSummary; draft: AutomationStoredDraft | null }> {
  const response = await invokeDrafts<ApiResponse & {
    flow: AutomationFlowSummary; draft: AutomationStoredDraft | null;
  }>({ action: 'get', workspaceId, flowId });
  return { flow: response.flow, draft: response.draft };
}
export async function saveAutomationDraft(
  workspaceId: string, graph: FlowDefinition, expectedRevision: number,
): Promise<{ flowId: string; revision: number; version: number }> {
  if (graph.status !== 'draft' || graph.schema_version !== '0.1-concept'
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('DRAFT_NOT_ELIGIBLE_FOR_SAVE');
  }
  // The revision is OCC-protected server-side. Never treat a conflict as an overwrite.
  const nextGraph = { ...graph, version: expectedRevision + 1 };
  const response = await invokeDrafts<ApiResponse & {
    flowId: string; revision: number; version: number; published: false;
  }>({
    action: 'save', workspaceId, flowId: graph.id,
    expectedRevision, graph: nextGraph,
  });
  if (response.published !== false) throw new Error('UNEXPECTED_PUBLISHED_STATE');
  return { flowId: response.flowId, revision: response.revision, version: response.version };
}
