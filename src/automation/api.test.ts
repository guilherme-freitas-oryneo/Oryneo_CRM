import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listRemoteAutomationTemplates, listRemoteAutomationExecutions, loadAutomationWorkspaces, saveRemoteAutomationDraft } from './api';
import type { FlowDefinition } from './flowDefinition';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../data', () => ({ supabase: { functions: { invoke } } }));
const workspaceId='11111111-1111-4111-8111-111111111111';
const graph: FlowDefinition = {
  id: '22222222-2222-4222-8222-222222222222', schema_version: '0.1-concept',
  kind: 'pipeline', name: 'Draft contract', version: 1, status: 'draft', nodes: [], edges: [],
};
describe('automations draft client contract', () => {
  beforeEach(() => { invoke.mockReset(); });

  it('discovers only the authenticated operator workspaces', async () => {
    invoke.mockResolvedValue({ data: { ok: true, workspaces: [{ id: workspaceId, slug: 'oryneo-crm', role: 'admin', active: false }] }, error: null });
    const result=await loadAutomationWorkspaces();
    expect(result).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith('automation-api',{body:{action:'workspaces'}});
  });
  it('creates draft without any permission to publish or execute', async () => {
    invoke.mockResolvedValue({ data: { ok: true, result: { id: graph.id, revision: 1, versionId: 'version' } }, error: null });
    await saveRemoteAutomationDraft(workspaceId,graph);
    expect(invoke).toHaveBeenCalledWith('automation-api',{body:{action:'create',workspaceId,graph}});
  });
  it('saves existing draft with the supplied optimistic revision', async () => {
    invoke.mockResolvedValue({ data: { ok: true, result: { id: graph.id, revision: 2, versionId: 'version' } }, error: null });
    await saveRemoteAutomationDraft(workspaceId,graph,1);
    expect(invoke).toHaveBeenCalledWith('automation-api',{body:{action:'save',workspaceId,flowId:graph.id,expectedRevision:1,graph}});
  });
  it('does not claim success if the server rejects a write', async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: 'Revision conflict' }, error: { name: 'FunctionsHttpError' } });
    await expect(saveRemoteAutomationDraft(workspaceId,graph,1)).rejects.toThrow('Revision conflict');
  });
  it('reads templates and executions without constructing send requests', async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, templates: [{ template_name: 'oryneo_followup_v3', provider_status: 'APPROVED' }] }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, executions: [] }, error: null });
    expect(await listRemoteAutomationTemplates(workspaceId)).toHaveLength(1);
    expect(await listRemoteAutomationExecutions(workspaceId)).toEqual([]);
    expect(invoke.mock.calls.every(([,arg]) => ['templates','executions'].includes(arg.body.action))).toBe(true);
  });
});
