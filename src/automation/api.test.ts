import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listRemoteAutomationTemplates, listRemoteAutomationExecutions, loadAutomationWorkspaces, loadRemoteReleaseGates, saveRemoteAutomationDraft } from './api';
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
  it('reports release NO-GO in read-only form and never authorizes dispatch', async () => {
    invoke.mockResolvedValue({
      data:{ok:true,readOnly:true,dispatchAuthorized:false,releaseReady:false,
        global:['global:legal','global:playbook'],
        channels:{crm:['crm:single_owner'],email:['email:mailbox_verified'],
          whatsapp:['whatsapp:consent_policy'],onboarding:[],billing:[]}},
      error:null,
    });
    const result=await loadRemoteReleaseGates(workspaceId);
    expect(result.releaseReady).toBe(false);
    expect(result.global).toContain('global:legal');
    expect(result.dispatchAuthorized).toBe(false);
    expect(invoke).toHaveBeenCalledWith('automation-api',{
      body:{action:'release-gates',workspaceId},
    });
  });
  it('fails closed if release readiness is returned with send permission', async () => {
    invoke.mockResolvedValue({data:{ok:true,readOnly:true,
      dispatchAuthorized:true,releaseReady:true,global:[],channels:{}},error:null});
    await expect(loadRemoteReleaseGates(workspaceId))
      .rejects.toThrow('Integridade da auditoria');
  });
  it('reads templates and executions without constructing send requests', async () => {
    invoke.mockResolvedValueOnce({ data: { ok: true, templates: [{ template_name: 'oryneo_followup_v3', provider_status: 'APPROVED' }] }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, executions: [] }, error: null });
    expect(await listRemoteAutomationTemplates(workspaceId)).toHaveLength(1);
    expect(await listRemoteAutomationExecutions(workspaceId)).toEqual([]);
    expect(invoke.mock.calls.every(([,arg]) => ['templates','executions'].includes(arg.body.action))).toBe(true);
  });
});
