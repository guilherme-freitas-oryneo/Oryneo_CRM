/**
 * Authenticated draft-only API. All server mutations require an existing CRM
 * session and a verified workspace role; no publish or dispatch endpoint exists.
 */
import { supabase } from '../data';
import type { FlowDefinition, FlowKind } from './flowDefinition';

export type WorkspaceGrant = {
  id: string; slug: string; active: boolean;
  role: 'viewer' | 'editor' | 'publisher' | 'admin';
};
export type RemoteFlow = {
  id: string; name: string; kind: FlowKind;
  revision: number; enabled: boolean; published_version_id: string | null; updated_at: string;
};
export type RemoteVersion = {
  id: string; version: number; status: string; graph_json: FlowDefinition;
};
export type RemoteFlowDetail = {
  ok: true; flow: RemoteFlow; version: RemoteVersion | null;
  role: WorkspaceGrant['role'];
};
type RpcPayload = Record<string, unknown>;
async function invoke<T>(body: RpcPayload): Promise<T> {
  const { data, error } = await supabase.functions.invoke('automation-api', { body });
  if (error || !data || data.ok !== true) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'O servidor de automações não respondeu.');
  }
  return data as T;
}
export async function loadAutomationWorkspaces(): Promise<WorkspaceGrant[]> {
  const result = await invoke<{ ok: true; workspaces: WorkspaceGrant[] }>({ action: 'workspaces' });
  return result.workspaces || [];
}
export async function listRemoteAutomationFlows(workspaceId: string): Promise<RemoteFlow[]> {
  const result = await invoke<{ ok: true; flows: RemoteFlow[] }>({ action: 'list', workspaceId });
  return result.flows || [];
}
export async function loadRemoteAutomationFlow(workspaceId: string, flowId: string): Promise<RemoteFlowDetail> {
  return invoke<RemoteFlowDetail>({ action: 'get', workspaceId, flowId });
}
export async function saveRemoteAutomationDraft(
  workspaceId: string, graph: FlowDefinition, expectedRevision?: number,
): Promise<{ id: string; revision: number; versionId: string }> {
  const body = expectedRevision === undefined
    ? { action: 'create', workspaceId, graph }
    : { action: 'save', workspaceId, flowId: graph.id, expectedRevision, graph };
  const result = await invoke<{ ok: true; result: { id: string; revision: number; versionId: string } }>(body);
  return result.result;
}
