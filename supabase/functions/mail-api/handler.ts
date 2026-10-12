const ACTIONS = new Set(['send', 'save-draft', 'delete-draft', 'set-flags', 'move', 'retry-send', 'attachment-url', 'link-deal', 'unlink-deal', 'sync-now']);
const ALLOWED_ORIGINS = new Set(['https://guilherme-freitas-oryneo.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']);

export type MailApiHandlerDependencies = {
  authenticate(token: string): Promise<string | null>;
  isMember(userId: string): Promise<boolean>;
  execute(userId: string, body: Record<string, unknown>): Promise<unknown>;
};

function responseHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(ALLOWED_ORIGINS.has(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
  };
}

function json(request: Request, body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(request) });
}

function publicError(error: unknown): { code: string; status: number } {
  const message = error instanceof Error ? error.message : '';
  const code = ['DRAFT_CONFLICT', 'MAIL_IN_PROGRESS', 'INVALID_MESSAGE', 'INVALID_RECIPIENT', 'INVALID_ATTACHMENT', 'ATTACHMENT_TOO_LARGE', 'ATTACHMENTS_TOO_LARGE', 'NOT_FOUND', 'MAIL_SEND', 'MAIL_APPEND']
    .find((candidate) => message.startsWith(candidate)) ?? 'MAIL_API_INTERNAL';
  const status = code === 'DRAFT_CONFLICT' || code === 'MAIL_IN_PROGRESS' ? 409 : code === 'NOT_FOUND' ? 404 : code.startsWith('INVALID') || code.includes('TOO_LARGE') ? 400 : 500;
  return { code, status };
}

export function createMailApiHandler(dependencies: MailApiHandlerDependencies): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(request) });
    if (request.method !== 'POST') return json(request, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    const authorization = request.headers.get('authorization') ?? '';
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json(request, { ok: false, error: 'UNAUTHORIZED' }, 401);
    const userId = await dependencies.authenticate(match[1]);
    if (!userId) return json(request, { ok: false, error: 'UNAUTHORIZED' }, 401);
    if (!await dependencies.isMember(userId)) return json(request, { ok: false, error: 'FORBIDDEN' }, 403);
    try {
      const text = await request.text();
      if (text.length > 25 * 1024 * 1024) return json(request, { ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
      const body = JSON.parse(text) as Record<string, unknown>;
      if (!ACTIONS.has(String(body.action ?? ''))) return json(request, { ok: false, error: 'INVALID_ACTION' }, 400);
      return json(request, { ok: true, data: await dependencies.execute(userId, body) }, 200);
    } catch (error) {
      if (error instanceof SyntaxError) return json(request, { ok: false, error: 'INVALID_JSON' }, 400);
      const translated = publicError(error);
      return json(request, { ok: false, error: translated.code }, translated.status);
    }
  };
}
