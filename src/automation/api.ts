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

export type AutomationTemplate = {
  id: string; template_name: string; language: string;
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  provider_status: string; provider_template_id: string | null;
  provider_account_id: string; synced_at: string;
  parameter_schema: { components_verified?: boolean };
};
export type AutomationExecution = {
  id: string; flow_version_id: string; state: string;
  started_at: string; finished_at: string | null; correlation_id: string | null;
};
export async function listRemoteAutomationTemplates(workspaceId: string): Promise<AutomationTemplate[]> {
  const result = await invoke<{ ok: true; templates: AutomationTemplate[] }>({ action: 'templates', workspaceId });
  return result.templates || [];
}
export async function listRemoteAutomationExecutions(workspaceId: string): Promise<AutomationExecution[]> {
  const result = await invoke<{ ok: true; executions: AutomationExecution[] }>({ action: 'executions', workspaceId });
  return result.executions || [];
}


export type ServerGraphValidation = {
  ok: boolean;
  issues: { code: string; path: string }[];
  nodeCount: number;
  edgeCount: number;
  dispatchAuthorized: false;
};
/** Only authenticated, non-emitting preflight; never proof of publication. */
export async function validateRemoteAutomationDraft(
  workspaceId: string, graph: FlowDefinition,
): Promise<ServerGraphValidation> {
  const result = await invoke<{
    ok: true; validation: ServerGraphValidation;
    preflightOnly: true; dispatchAuthorized: false;
  }>({ action: 'validate', workspaceId, graph });
  return result.validation;
}
