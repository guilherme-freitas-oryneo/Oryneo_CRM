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
  id: string; name: string; kind: FlowKind; slug?: string;
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


export type DisabledPublication = {
  flowId:string;versionId:string;revision:number;
  contentSha256:string;enabled:false;
};
/**
 * Freezes the already-saved canonical draft. The backend re-reads and validates
 * it under a publisher role. This NEVER enables execution or message delivery.
 */
export async function freezeRemoteAutomationVersion(
  workspaceId:string,flowId:string,expectedRevision:number,
):Promise<DisabledPublication> {
  const result=await invoke<{
    ok:true;result:DisabledPublication;
    publishedDisabled:true;dispatchAuthorized:false;
  }>({action:'publish-disabled',workspaceId,flowId,expectedRevision});
  return result.result;
}


export type CatalogChoice={id:string;name:string;variable_numbers?:string[]};
export type NodeReferenceCatalog={
  stages:CatalogChoice[];
  templates:CatalogChoice[];
  knowledge:CatalogChoice[];
  dictionaries:CatalogChoice[];
};
/** Server-scoped lists. Client selections are still revalidated at publication. */
export async function loadRemoteNodeCatalog(workspaceId:string):Promise<NodeReferenceCatalog>{
  const result=await invoke<{ok:true;catalog:NodeReferenceCatalog;readOnly:true}>({
    action:'catalog',workspaceId,
  });
  return result.catalog;
}


export type AutomationRuntimeStatus={
  workspaceActive:boolean;
  mode:'disabled'|'shadow'|'live';
  emergencyStop:boolean;
  updatedAt:string;
  flows:number;
  publishedVersions:number;
  pendingEvents:number;
  executions:number;
  actionRows:number;
  waitingTimers:number;
  dueTimers:number;
  cancelledTimers:number;
  queuedActions:number;
  leasedActions:number;
  uncertainActions:number;
  sentActions:number;
  dispatchAuthorized:false;
};
/** Observability only; never enables a flow or dispatches an action. */
export async function loadRemoteAutomationRuntime(
  workspaceId:string,
):Promise<AutomationRuntimeStatus>{
  const result=await invoke<{
    ok:true;readOnly:true;runtime:AutomationRuntimeStatus;
  }>({action:'runtime',workspaceId});
  return result.runtime;
}


export type ServerShadowPreview={
  shadowOnly:true;
  dispatchAuthorized:false;
  state:'blocked'|'completed'|'awaiting_server_outcome'|'waiting';
  trace:{nodeId:string;type:string;status:string;nextPort?:string}[];
  plannedActions:{nodeId:string;type:string;actionKey:string}[];
  issues:{code:string;path:string}[];
};
/**
 * Hypothetical, non-persisting preview against the current server graph guard.
 * Never pass real customer contact information or an invented payment receipt.
 */
export async function simulateRemoteAutomationDraft(
 workspaceId:string,graph:FlowDefinition,eventType:string,
 sampleContext:Record<string,unknown>={},
):Promise<ServerShadowPreview>{
 const result=await invoke<{
  ok:true;dryRun:true;simulationOnly:true;dispatchAuthorized:false;
  persisted:false;result:ServerShadowPreview;
 }>({action:'simulate',workspaceId,graph,eventType,sampleContext});
 if(!result.dryRun||!result.simulationOnly||result.dispatchAuthorized!==false||
    result.persisted!==false||result.result.dispatchAuthorized!==false)
   throw new Error('Simulação sem garantias de segurança.');
 return result.result;
}

/** Server-authorized, workspace-scoped execution trace. Never returns payloads or PII. */
export type AutomationExecutionDetail={
  execution:{id:string;flow_version_id:string;state:string;started_at:string;finished_at:string|null};
  nodes:{id:string;node_id:string;state:string;attempt:number;result_code:string|null;created_at:string}[];
  actions:{node_id:string;action_type:string;state:string;attempts:number;result_code:string|null;created_at:string}[];
  timers:{id:string;node_id:string;state:string;reason_code:string|null;due_at:string;created_at:string;updated_at:string}[];
};
export async function loadRemoteAutomationExecutionDetail(
 workspaceId:string,executionId:string,
):Promise<AutomationExecutionDetail>{
 const result=await invoke<{ok:true;readOnly:true;sanitized:true;dispatchAuthorized:false}
  & AutomationExecutionDetail>({action:'execution-detail',workspaceId,executionId});
 if(!result.readOnly||!result.sanitized||result.dispatchAuthorized!==false)
  throw new Error('Resposta de auditoria não verificada.');
 return {execution:result.execution,nodes:result.nodes||[],actions:result.actions||[],timers:result.timers||[]};
}

/** Read-only, authenticated ownership inventory; not a release control. */
export type CommercialReadiness={
 channels:{channel:'whatsapp'|'email'|'crm'|'onboarding'|'billing';
  owner:'legacy'|'new_engine';legacyPaused:boolean;releaseAttested:boolean;
  eligibleForControlledQueue:boolean}[];
 runtime:{mode:'disabled'|'shadow'|'live';emergencyStop:boolean;workspaceActive:boolean};
};
export async function loadRemoteCommercialReadiness(workspaceId:string):Promise<CommercialReadiness>{
 const result=await invoke<CommercialReadiness&{
  ok:true;readOnly:true;dispatchAuthorized:false;
 }>({action:'commercial-readiness',workspaceId});
 if(result.readOnly!==true||result.dispatchAuthorized!==false)
  throw new Error('Integração sem garantias de leitura.'); 
 return {channels:result.channels||[],runtime:result.runtime};
}

/** Stage 4 semantic editor: read, create draft, freeze disabled. Never send. */
export type SemanticDraftEntry={
 id:string;label:string;positive:string[];negative:string[];synonyms:string[];
 risk:'normal'|'human_review';
};
export type SemanticDraft={
 releaseVersion:number;language:'pt_BR';entries:SemanticDraftEntry[];
};
export type SemanticSnapshot={
 knowledge:{id:string;release_version:number;status:string;approved_by:string|null;content_sha256:string|null}[];
 dictionaries:{id:string;version:number;status:string;approved:boolean;
  contentHash:string|null;dictionary:SemanticDraft|null}[];
 selected:{knowledge_release_id:string|null;dictionary_release_id:string|null;
   revision:number;enabled:boolean}|null;
 role:WorkspaceGrant['role'];
};
export async function listRemoteSemanticReleases(workspaceId:string):Promise<SemanticSnapshot>{
 const r=await invoke<{ok:true;readOnly:true;dispatchAuthorized:false}&SemanticSnapshot>({
  action:'sdr-semantic-list',workspaceId});
 if(r.dispatchAuthorized!==false||!r.readOnly)throw Error('Resposta do catálogo sem garantia de leitura.');
 return {knowledge:r.knowledge,dictionaries:r.dictionaries,selected:r.selected,role:r.role};
}
export async function createRemoteSemanticDraft(workspaceId:string,
 dictionary:SemanticDraft,expectedLatestVersion:number
):Promise<{id:string;release_version:number;status:string}>{
 const r=await invoke<{ok:true;created:{id:string;release_version:number;status:string};
  published:false;dispatchAuthorized:false}>({
  action:'sdr-dictionary-create',workspaceId,dictionary,expectedLatestVersion});
 if(r.published!==false||r.dispatchAuthorized!==false)throw Error('Rascunho retornou estado inseguro.');
 return r.created;
}
export async function freezeRemoteSemanticPair(workspaceId:string,
 knowledgeId:string,dictionaryId:string,expectedRevision:number,
):Promise<{revision:number;dispatchAuthorized:false}>{
 const r=await invoke<{ok:true;result:{revision:number;dispatchAuthorized:false};
  publishedDisabled:true;dispatchAuthorized:false}>({
  action:'sdr-publish-disabled',workspaceId,knowledgeId,dictionaryId,expectedRevision});
 if(!r.publishedDisabled||r.dispatchAuthorized!==false||
   r.result.dispatchAuthorized!==false)throw Error('Publicação não permaneceu inativa.');
 return r.result;
}

export type ReleaseGateStatus={
  global:string[];
  channels:Record<'crm'|'email'|'whatsapp'|'onboarding'|'billing',string[]>;
  releaseReady:boolean;
  readOnly:true;
  dispatchAuthorized:false;
};
export async function loadRemoteReleaseGates(workspaceId:string):Promise<ReleaseGateStatus>{
  const r=await invoke<ReleaseGateStatus&{ok:true}>({
    action:'release-gates',workspaceId,
  });
  if(r.readOnly!==true||r.dispatchAuthorized!==false||!Array.isArray(r.global))
    throw new Error('Integridade da auditoria de release não comprovada.');
  return r;
}

