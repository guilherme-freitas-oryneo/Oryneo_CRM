/**
 * ORYNEO Automations draft API.
 * Deliberately excludes publish, event ingestion and outbound execution.
 * Service-key DB access is always preceded by live JWT verification, CRM
 * membership and workspace role checks. Never trust client-supplied actor IDs.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.90.1';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
type Membership = { workspace_id: string; role: string };
type Graph = { id: string; kind: string; name: string; status: string; schema_version: string;
  nodes: unknown[]; edges: unknown[] };

function graphFrom(input: unknown): Graph | null {
  if (!isRecord(input) || !validUuid(input.id) || !['sdr', 'pipeline'].includes(String(input.kind))
    || typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 160
    || input.status !== 'draft' || !['0.1-concept','1.0.0'].includes(String(input.schema_version))
    || !Array.isArray(input.nodes) || !Array.isArray(input.edges)
    || input.nodes.length > 500 || input.edges.length > 1000) return null;
  return input as Graph;
}
const errorCode = (code?: string) => {
  if (code === '42501') return { status: 403, body: { error: 'Sem permissão para editar os fluxos.' } };
  if (code === '40001') return { status: 409, body: { error: 'O rascunho foi alterado por outra sessão. Recarregue antes de salvar.', code: 'REVISION_CONFLICT' } };
  if (code === '23505') return { status: 409, body: { error: 'Já existe um fluxo com esse identificador.' } };
  if (code === '22023') return { status: 400, body: { error: 'Configuração de fluxo inválida.' } };
  if (code === 'P0002') return { status: 404, body: { error: 'Fluxo não encontrado.' } };
  return { status: 503, body: { error: 'Não foi possível concluir a operação no banco.' } };
};

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Método inválido.' }, 405);
  if (!url || !serviceKey) return reply({ error: 'Serviço não configurado.' }, 503);
  const bearer = request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer) return reply({ error: 'Autenticação necessária.' }, 401);
  const { data: auth, error: authErr } = await db.auth.getUser(bearer);
  if (authErr || !auth.user) return reply({ error: 'Sessão inválida.' }, 401);
  const actor = auth.user.id;
  const { data: crmMember, error: crmErr } = await db.from('crm_members')
    .select('user_id').eq('user_id', actor).maybeSingle();
  if (crmErr) return reply({ error: 'Não foi possível verificar o acesso.' }, 503);
  if (!crmMember) return reply({ error: 'Acesso restrito ao CRM ORYNEO.' }, 403);

  const size = Number(request.headers.get('Content-Length') || 0);
  if (size > 280_000) return reply({ error: 'Solicitação acima do limite.' }, 413);
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 280_000) return reply({ error: 'Solicitação acima do limite.' }, 413);
    body = JSON.parse(raw);
  } catch { return reply({ error: 'Formato JSON inválido.' }, 400); }
  if (!isRecord(body)) return reply({ error: 'Solicitação inválida.' }, 400);

  const action = String(body.action || '');
  if (action === 'workspaces') {
    const { data, error } = await db.from('automation_workspace_members')
      .select('workspace_id,role').eq('user_id', actor).limit(30);
    if (error) return reply({ error: 'Falha ao consultar permissões de automação.' }, 503);
    const ids = (data || []).map(item => item.workspace_id);
    if (!ids.length) return reply({ ok: true, workspaces: [] });
    const { data: details, error: detailsError } = await db.from('automation_workspaces')
      .select('id,slug,active').in('id', ids);
    if (detailsError) return reply({ error: 'Falha ao consultar workspaces.' }, 503);
    return reply({ ok: true, workspaces: (data || []).map(item => ({
      id: item.workspace_id, role: item.role,
      slug: details?.find(ws => ws.id === item.workspace_id)?.slug || '',
      active: details?.find(ws => ws.id === item.workspace_id)?.active === true,
    })) });
  }
  const workspaceId = body.workspaceId;
  if (!validUuid(workspaceId)) return reply({ error: 'Workspace inválido.' }, 400);
  const { data: grant, error: grantErr } = await db.from('automation_workspace_members')
    .select('workspace_id,role').eq('workspace_id', workspaceId)
    .eq('user_id', actor).maybeSingle();
  if (grantErr) return reply({ error: 'A autorização não pôde ser verificada.' }, 503);
  if (!grant) return reply({ error: 'Workspace não encontrado.' }, 404);
  const member = grant as Membership;
  const canEdit = ['editor', 'publisher', 'admin'].includes(member.role);

  if (action === 'list') {
    const { data, error } = await db.from('automation_flows')
      .select('id,name,kind,revision,enabled,published_version_id,updated_at')
      .eq('workspace_id', workspaceId).order('updated_at', { ascending: false }).limit(100);
    return error ? reply({ error: 'Falha ao listar fluxos.' }, 503)
      : reply({ ok: true, flows: data || [], role: member.role });
  }

  if (action === 'get') {
    if (!validUuid(body.flowId)) return reply({ error: 'Fluxo inválido.' }, 400);
    const { data: flow, error: flowErr } = await db.from('automation_flows')
      .select('id,name,kind,revision,published_version_id,enabled')
      .eq('workspace_id', workspaceId).eq('id', body.flowId).maybeSingle();
    if (flowErr) return reply({ error: 'Falha ao abrir fluxo.' }, 503);
    if (!flow) return reply({ error: 'Fluxo não encontrado.' }, 404);
    const { data: version, error: versionErr } = await db.from('automation_flow_versions')
      .select('id,version,status,graph_json')
      .eq('workspace_id', workspaceId).eq('flow_id', body.flowId)
      .order('version', { ascending: false }).limit(1).maybeSingle();
    return versionErr ? reply({ error: 'Falha ao abrir versão.' }, 503)
      : reply({ ok: true, flow, version, role: member.role });
  }

  if (!canEdit) return reply({ error: 'Somente editores podem modificar rascunhos.' }, 403);

  if (action === 'create') {
    const graph = graphFrom(body.graph);
    if (!graph) return reply({ error: 'Grafo inválido.' }, 400);
    const { data, error } = await db.rpc('automation_draft_create', {
      p_workspace_id: workspaceId, p_actor_id: actor, p_graph: graph,
    });
    if (error) { const e = errorCode(error.code); return reply(e.body, e.status); }
    return reply({ ok: true, result: data }, 201);
  }

  if (action === 'save') {
    const graph = graphFrom(body.graph);
    if (!graph || body.flowId !== graph.id || !Number.isSafeInteger(body.expectedRevision)
      || Number(body.expectedRevision) < 1) return reply({ error: 'Grafo ou revisão inválidos.' }, 400);
    const { data, error } = await db.rpc('automation_draft_save', {
      p_workspace_id: workspaceId, p_actor_id: actor,
      p_flow_id: graph.id, p_expected_revision: body.expectedRevision, p_graph: graph,
    });
    if (error) { const e = errorCode(error.code); return reply(e.body, e.status); }
    return reply({ ok: true, result: data });
  }

  // These actions are intentionally impossible until server-side compiler,
  // immutable snapshots and approved dispatch policies are implemented.
  if (action === 'publish' || action === 'execute' || action === 'send') {
    return reply({ error: 'Publicação e disparos ainda não estão habilitados.', code: 'RUNTIME_DISABLED' }, 409);
  }
  return reply({ error: 'Ação desconhecida.' }, 400);
});
