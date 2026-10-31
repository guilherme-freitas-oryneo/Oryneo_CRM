/**
 * ORYNEO Automations draft API.
 * Deliberately excludes publish, event ingestion and outbound execution.
 * Service-key DB access is always preceded by live JWT verification, CRM
 * membership and workspace role checks. Never trust client-supplied actor IDs.
 */
import { inspectServerGraph } from './graphGuard.ts';
import { loadTrustedReferences } from './trustedReferences.ts';
import { planServerShadow } from './shadowEngine.ts';
import { parseSimulationFixture } from './simulationBoundary.ts';
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

  if (action === 'templates') {
    const { data, error } = await db.from('automation_template_registry')
      .select('id,template_name,language,category,provider_status,provider_template_id,provider_account_id,parameter_schema,synced_at')
      .eq('workspace_id', workspaceId).order('template_name').limit(200);
    return error ? reply({ error: 'Não foi possível carregar o catálogo Meta.' }, 503)
      : reply({ ok: true, templates: data || [],
          componentsVerified: (data || []).length > 0 && (data || []).every(t =>
            t.provider_status === 'APPROVED' && t.language === 'pt_BR'
            && t.parameter_schema?.components_verified === true
            && t.parameter_schema?.send_guard === 'backend_required'),
          // This is catalog metadata, NEVER permission to send.
          dispatchAuthorized: false,
        });
  }

  // Authorized read-only choices for typed node inspectors. Never send the
  // whole commercial record or unverified template components to the browser.
  if (action === 'catalog') {
    const [stages,templates,knowledge,dictionaries]=await Promise.all([
      db.from('crm_records').select('id,data').eq('kind','stage').eq('deleted',false).limit(100),
      db.from('automation_template_registry')
        .select('id,template_name,provider_status,parameter_schema,language')
        .eq('workspace_id',workspaceId).limit(200),
      db.from('automation_knowledge_release').select('id,release_version')
        .eq('workspace_id',workspaceId).eq('status','published').limit(100),
      db.from('automation_intent_dictionary').select('id,release_version')
        .eq('workspace_id',workspaceId).eq('status','published').limit(100),
    ]);
    if(stages.error||templates.error||knowledge.error||dictionaries.error)
      return reply({error:'Catálogo canônico indisponível.'},503);
    return reply({ok:true,catalog:{
      stages:(stages.data||[]).map(x=>({id:x.id,name:
        typeof x.data?.name==='string'?x.data.name:'Etapa sem nome'})),
      templates:(templates.data||[])
        .filter(t=>t.provider_status==='APPROVED'&&t.language==='pt_BR'
          &&t.parameter_schema&&typeof t.parameter_schema==='object'
          &&!Array.isArray(t.parameter_schema)
          &&t.parameter_schema.components_verified===true)
        .map(t=>({id:t.id,name:t.template_name})),
      knowledge:(knowledge.data||[]).map(x=>({id:x.id,name:'Conhecimento v'+x.release_version})),
      dictionaries:(dictionaries.data||[]).map(x=>({id:x.id,name:'Intenções v'+x.release_version})),
    },readOnly:true});
  }

  // Member-scoped operational visibility; no payloads, customer data or secrets.
  // Reading status does not start a worker, publish a version or change a gate.
  if (action === 'runtime') {
    const [settings, workspaceState, flowCounts, publishedCounts, inboxCounts,
      runningCounts, actionCounts,waitingCounts,dueCounts,cancelledCounts,
      queuedActions,leasedActions,uncertainActions,sentActions] = await Promise.all([
      db.from('automation_runtime_settings').select('mode,emergency_stop,updated_at')
        .eq('workspace_id', workspaceId).maybeSingle(),
      db.from('automation_workspaces').select('active')
        .eq('id', workspaceId).maybeSingle(),
      db.from('automation_flows').select('id', { head:true, count:'exact' })
        .eq('workspace_id', workspaceId),
      db.from('automation_flow_versions').select('id', { head:true, count:'exact' })
        .eq('workspace_id', workspaceId).eq('status', 'published'),
      db.from('automation_event_inbox').select('id', { head:true, count:'exact' })
        .eq('workspace_id', workspaceId).eq('state','pending'),
      db.from('automation_executions').select('id', { head:true, count:'exact' })
        .eq('workspace_id', workspaceId),
      db.from('automation_action_outbox').select('id', { head:true, count:'exact' })
        .eq('workspace_id', workspaceId),
      db.from('automation_wait_timers').select('id',{head:true,count:'exact'})
        .eq('workspace_id',workspaceId).eq('state','waiting'),
      db.from('automation_wait_timers').select('id',{head:true,count:'exact'})
        .eq('workspace_id',workspaceId).eq('state','due'),
      db.from('automation_wait_timers').select('id',{head:true,count:'exact'})
        .eq('workspace_id',workspaceId).eq('state','cancelled'),
      db.from('automation_action_outbox').select('id',{head:true,count:'exact'})
        .eq('workspace_id',workspaceId).eq('state','queued'),
      db.from('automation_action_outbox').select('id',{head:true,count:'exact'})
        .eq('workspace_id',workspaceId).eq('state','leased'),
      db.from('automation_action_outbox').select('id',{head:true,count:'exact'})
        .eq('workspace_id',workspaceId).eq('state','uncertain'),
      db.from('automation_action_outbox').select('id',{head:true,count:'exact'})
        .eq('workspace_id',workspaceId).eq('state','sent'),
    ]);
    if ([settings, workspaceState, flowCounts, publishedCounts, inboxCounts,
      runningCounts, actionCounts,waitingCounts,dueCounts,cancelledCounts,
      queuedActions,leasedActions,uncertainActions,sentActions].some(r => r.error) ||
      !settings.data || !workspaceState.data)
      return reply({error:'Estado do motor indisponível.'},503);
    return reply({ok:true,readOnly:true,runtime:{
      workspaceActive:workspaceState.data.active===true,
      mode:settings.data.mode,
      emergencyStop:settings.data.emergency_stop===true,
      updatedAt:settings.data.updated_at,
      flows:flowCounts.count||0,
      publishedVersions:publishedCounts.count||0,
      pendingEvents:inboxCounts.count||0,
      executions:runningCounts.count||0,
      actionRows:actionCounts.count||0,
      waitingTimers:waitingCounts.count||0,
      dueTimers:dueCounts.count||0,
      cancelledTimers:cancelledCounts.count||0,
      queuedActions:queuedActions.count||0,
      leasedActions:leasedActions.count||0,
      uncertainActions:uncertainActions.count||0,
      sentActions:sentActions.count||0,
      dispatchAuthorized:false,
    }});
  }

  if (action === 'executions') {
    const { data, error } = await db.from('automation_executions')
      .select('id,flow_version_id,state,started_at,finished_at,correlation_id')
      .eq('workspace_id', workspaceId).order('started_at', { ascending: false }).limit(100);
    return error ? reply({ error: 'Não foi possível carregar as execuções.' }, 503)
      : reply({ ok: true, executions: data || [] });
  }


  // Authenticated preflight reads canonical references on the server.
  // Results cannot be reused as an authorization token.
  if (action === 'simulate') {
    // Hypothetical inputs only: no live CRM reads, action outbox or provider calls.
    if (!graphFrom(body.graph)) return reply({error:'Rascunho inválido para simulação.'},422);
    try {
      const refs=await loadTrustedReferences(db,workspaceId);
      const fixture=parseSimulationFixture(body.sampleContext,body.eventType,refs.eventTypes);
      if(!fixture.ok)return reply({error:'Parâmetros da simulação inválidos.',code:fixture.code},422);
      const graph=body.graph as Graph;
      const result=await planServerShadow({...graph,status:'published'}, {
        workspaceId,flowVersionId:crypto.randomUUID(),
        source:String(body.eventType).startsWith('conversation.')?'whatsapp':
          String(body.eventType).startsWith('billing.')?'stripe':'crm',
        eventId:'sim.'+crypto.randomUUID(),eventType:String(body.eventType),
        context:fixture.fixture,
      },refs);
      return reply({ok:true,dryRun:true,simulationOnly:true,
        dispatchAuthorized:false,persisted:false,
        assumptions:['HYPOTHETICAL_CONTEXT','NO_LIVE_PAYMENT_PROOF','NO_MESSAGES_SENT'],
        result});
    } catch {
      return reply({error:'Simulação isolada indisponível.'},503);
    }
  }

  if (action === 'validate') {
    try {
      const references=await loadTrustedReferences(db,workspaceId);
      const validation=inspectServerGraph(body.graph,references);
      return reply({ok:true,validation,preflightOnly:true,dispatchAuthorized:false});
    } catch {
      return reply({error:'Referências canônicas indisponíveis para validação.'},503);
    }
  }

  /**
   * Manual freeze-only release. The graph is re-read from the DB and independently
   * validated: a client-supplied graph, allowlist or success boolean is NEVER used.
   * This cannot enable automations and does not enqueue, schedule or send actions.
   */
  if (action === 'publish-disabled') {
    if (!['admin','publisher'].includes(member.role)) {
      return reply({error:'Papel de publicador obrigatório.'},403);
    }
    if (!validUuid(body.flowId) || !Number.isSafeInteger(body.expectedRevision)
      || Number(body.expectedRevision)<1) {
      return reply({error:'Identificador ou revisão inválidos.'},400);
    }
    const {data:settings,error:settingsError}=await db.from('automation_runtime_settings')
      .select('mode,emergency_stop').eq('workspace_id',workspaceId).maybeSingle();
    if(settingsError) return reply({error:'Estado de segurança indisponível.'},503);
    if(settings?.mode!=='disabled'||settings?.emergency_stop!==true)
      return reply({error:'Publicação sem ativação exige runtime desabilitado e parada de emergência.'},409);
    const {data:flow,error:flowError}=await db.from('automation_flows')
      .select('id,kind,revision').eq('workspace_id',workspaceId).eq('id',body.flowId).maybeSingle();
    if(flowError) return reply({error:'Falha ao consultar versão canônica.'},503);
    if(!flow) return reply({error:'Fluxo não encontrado.'},404);
    if(flow.revision!==body.expectedRevision)
      return reply({error:'O fluxo foi alterado. Reabra antes de publicar.',code:'REVISION_CONFLICT'},409);
    const {data:version,error:versionError}=await db.from('automation_flow_versions')
      .select('id,status,graph_json').eq('workspace_id',workspaceId).eq('flow_id',flow.id)
      .eq('status','draft').order('version',{ascending:false}).limit(1).maybeSingle();
    if(versionError) return reply({error:'Falha ao consultar rascunho.'},503);
    if(!version) return reply({error:'Não existe rascunho para publicação.'},409);
    const graph=version.graph_json;
    if(!graphFrom(graph)||graph.id!==flow.id||graph.kind!==flow.kind)
      return reply({error:'Rascunho inconsistente.'},422);
    let validation;
    try {
      const refs=await loadTrustedReferences(db,workspaceId);
      validation=inspectServerGraph(graph,refs);
    } catch {
      return reply({error:'Referências não puderam ser verificadas.'},503);
    }
    if(!validation.ok) return reply({
      error:'O servidor encontrou bloqueios de publicação.',validation,code:'PREFLIGHT_FAILED',
    },422);
    const {data:released,error:releaseError}=await db.rpc('automation_publish_disabled',{
      p_workspace_id:workspaceId,p_actor_id:actor,p_flow_id:flow.id,
      p_expected_revision:body.expectedRevision,p_graph:graph,
      p_validation:{
        ok:true,issues:[],dispatchAuthorized:false,
        preflight:'server',nodeCount:validation.nodeCount,
        edgeCount:validation.edgeCount,
      },
    });
    if(releaseError){const mapped=errorCode(releaseError.code);return reply(mapped.body,mapped.status);}
    return reply({ok:true,result:released,publishedDisabled:true,dispatchAuthorized:false});
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
