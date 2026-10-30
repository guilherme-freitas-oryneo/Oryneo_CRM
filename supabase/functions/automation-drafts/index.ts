/**
 * ORYNEO Automation Drafts API.
 *
 * User-JWT authenticated, workspace scoped, draft-only.
 * No publication, execution, provider integration, migration or external side effect.
 *
 * The referenced SQL RPC performs atomic revisions and checks editor roles again.
 * This function MUST NOT be deployed until its additive schema/RPC migrations pass
 * disposable DB CI, and the deployment origin/access permissions are audited.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.90.1';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nodeTypes = new Set([
  'trigger','condition','intent_classifier','knowledge_lookup','ai_generate',
  'whatsapp_template','whatsapp_reply','email','crm_stage_change','crm_task',
  'crm_update','billing_read','wait','human_handoff','notify','stop','end',
]);
const isObj = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
const validUuid = (v: unknown): v is string => typeof v === 'string' && uuid.test(v);
function validDraft(graph: unknown, flowId: string, revision: number): boolean {
  if (!isObj(graph) || graph.status !== 'draft' || graph.schema_version !== '0.1-concept'
    || graph.id !== flowId || !id(graph.name)
    || !['pipeline','sdr'].includes(String(graph.kind))
    || !Number.isSafeInteger(graph.version) || graph.version !== revision + 1
    || !Array.isArray(graph.nodes) || graph.nodes.length === 0 || graph.nodes.length > 500
    || !Array.isArray(graph.edges) || graph.edges.length > 1000) return false;
  const seen = new Set<string>();
  for (const node of graph.nodes) {
    if (!isObj(node) || !id(node.id) || seen.has(node.id) || !nodeTypes.has(String(node.type))
      || !id(node.label) || !isObj(node.position)
      || typeof node.position.x !== 'number' || !Number.isFinite(node.position.x)
      || typeof node.position.y !== 'number' || !Number.isFinite(node.position.y)
      || !isObj(node.config) || !Array.isArray(node.ports)
      || node.ports.length > 24 || !node.ports.every(id)) return false;
    seen.add(node.id as string);
  }
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (!isObj(edge) || !id(edge.id) || edgeIds.has(edge.id)
      || !id(edge.source) || !id(edge.target)
      || !seen.has(edge.source as string) || !seen.has(edge.target as string)
      || !id(edge.source_port) || !id(edge.target_port)) return false;
    edgeIds.add(edge.id as string);
  }
  return true;
}
function apiError(message: string, status: number) { return json({ ok: false, error: message }, status); }

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return apiError('METHOD_NOT_ALLOWED', 405);
  const bearer = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!bearer) return apiError('AUTH_REQUIRED', 401);
  const { data: auth, error: authError } = await db.auth.getUser(bearer);
  if (authError || !auth.user) return apiError('SESSION_INVALID', 401);
  const { data: crmMember, error: crmError } = await db.from('crm_members')
    .select('user_id').eq('user_id', auth.user.id).maybeSingle();
  if (crmError) return apiError('CRM_MEMBERSHIP_UNAVAILABLE', 503);
  if (!crmMember) return apiError('CRM_MEMBERSHIP_REQUIRED', 403);

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 225_000) return apiError('PAYLOAD_TOO_LARGE', 413);
  let body: unknown;
  try {
    const raw = await request.text();
    if (!raw || raw.length > 225_000) return apiError('PAYLOAD_TOO_LARGE', 413);
    body = JSON.parse(raw);
  } catch { return apiError('INVALID_JSON', 400); }
  if (!isObj(body)) return apiError('INVALID_PAYLOAD', 400);
  const action = body.action;
  if (action === 'workspaces') {
    const { data: memberships, error: listError } = await db.from('automation_workspace_members')
      .select('workspace_id,role').eq('user_id', auth.user.id).limit(80);
    if (listError) return apiError('WORKSPACE_LIST_UNAVAILABLE', 503);
    if (!memberships?.length) return json({ ok: true, workspaces: [] });
    const allowedIds = memberships.map(m => m.workspace_id);
    const { data: available, error: workspaceListError } = await db.from('automation_workspaces')
      .select('id,slug,active').eq('active', true).in('id', allowedIds).limit(80);
    if (workspaceListError) return apiError('WORKSPACE_LIST_UNAVAILABLE', 503);
    const roles = new Map(memberships.map(m => [m.workspace_id, m.role]));
    return json({ ok: true, workspaces: (available ?? []).map(w => ({
      id: w.id, slug: w.slug, role: roles.get(w.id),
    })) });
  }
  const workspaceId = body.workspaceId;
  if (!validUuid(workspaceId)) return apiError('WORKSPACE_ID_INVALID', 400);
  const [{ data: workspace, error: workspaceError },
    { data: member, error: membershipError }] = await Promise.all([
    db.from('automation_workspaces').select('id,active').eq('id', workspaceId).maybeSingle(),
    db.from('automation_workspace_members').select('role')
      .eq('workspace_id', workspaceId).eq('user_id', auth.user.id).maybeSingle(),
  ]);
  if (workspaceError || membershipError) return apiError('WORKSPACE_ACCESS_UNAVAILABLE', 503);
  if (!workspace?.active || !member) return apiError('WORKSPACE_NOT_FOUND', 404);

  if (action === 'list') {
    const { data, error } = await db.from('automation_flows')
      .select('id,slug,name,kind,enabled,revision,published_version_id,updated_at')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false }).limit(80);
    if (error) return apiError('FLOWS_UNAVAILABLE', 503);
    return json({ ok: true, flows: data ?? [], canEdit: ['editor','publisher','admin'].includes(member.role) });
  }

  if (action === 'get') {
    const flowId = body.flowId;
    if (!validUuid(flowId)) return apiError('FLOW_ID_INVALID', 400);
    const { data: flow, error } = await db.from('automation_flows')
      .select('id,name,kind,revision,enabled,published_version_id,updated_at')
      .eq('workspace_id', workspaceId).eq('id', flowId).maybeSingle();
    if (error) return apiError('FLOW_UNAVAILABLE', 503);
    if (!flow) return apiError('FLOW_NOT_FOUND', 404);
    const { data: version, error: versionError } = await db.from('automation_flow_versions')
      .select('id,version,schema_version,graph_json,created_at')
      .eq('workspace_id', workspaceId).eq('flow_id', flowId).eq('status', 'draft')
      .order('version', { ascending: false }).limit(1).maybeSingle();
    if (versionError) return apiError('DRAFT_UNAVAILABLE', 503);
    return json({ ok: true, flow, draft: version ?? null });
  }

  if (action === 'save') {
    if (!['editor','publisher','admin'].includes(member.role)) return apiError('EDITOR_ROLE_REQUIRED', 403);
    if (!validUuid(body.flowId) || !Number.isSafeInteger(body.expectedRevision)
      || Number(body.expectedRevision) < 0 || !validDraft(body.graph, body.flowId, Number(body.expectedRevision))) {
      return apiError('DRAFT_INVALID', 400);
    }
    const graph = body.graph as Record<string, unknown>;
    const { data, error } = await db.rpc('automation_save_draft', {
      p_workspace_id: workspaceId,
      p_actor_id: auth.user.id,
      p_flow_id: body.flowId,
      p_expected_revision: body.expectedRevision,
      p_name: graph.name,
      p_kind: graph.kind,
      p_graph: graph,
    });
    if (error) {
      // Deliberately never echo a database error containing client-supplied values.
      if (error.code === '40001' || error.code === '23505') return apiError('REVISION_CONFLICT', 409);
      if (error.code === '42501') return apiError('EDITOR_ROLE_REQUIRED', 403);
      if (error.code === '22023') return apiError('DRAFT_INVALID', 400);
      if (error.code === 'P0002') return apiError('FLOW_NOT_FOUND', 404);
      return apiError('DRAFT_SAVE_UNAVAILABLE', 503);
    }
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return apiError('DRAFT_SAVE_UNAVAILABLE', 503);
    return json({
      ok: true, flowId: row.flow_id, revision: row.saved_revision,
      version: row.saved_version, published: false,
    });
  }
  // Intentionally no publish/enable/delete/action-dispatch endpoint.
  return apiError('UNKNOWN_ACTION', 400);
});
