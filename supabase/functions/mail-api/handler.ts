const ACTIONS = new Set(['list-drafts', 'get-draft', 'export-message', 'quota', 'send', 'save-draft', 'delete-draft', 'set-flags', 'move', 'retry-send', 'attachment-url', 'link-deal', 'unlink-deal', 'sync-now']);
const ALLOWED_ORIGINS = new Set(['https://crm.oryneo.com.br', 'https://guilherme-freitas-oryneo.github.io', 'http://localhost:5173', 'http://127.0.0.1:5173']);

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
  const code = ['MESSAGE_CHANGED', 'DRAFT_CONFLICT', 'MAIL_IN_PROGRESS', 'FIRST_CONTACT_STAGE', 'FIRST_CONTACT_ALREADY_SENT', 'FIRST_CONTACT_RESEND', 'FIRST_CONTACT_INVALID_EMAIL', 'FIRST_CONTACT_INCOMPLETE', 'FIRST_CONTACT_MAILBOX', 'INVALID_MESSAGE', 'INVALID_RECIPIENT', 'INVALID_ATTACHMENT', 'ATTACHMENT_TOO_LARGE', 'ATTACHMENTS_TOO_LARGE', 'NOT_FOUND', 'MAIL_SEND', 'MAIL_APPEND']
    .find((candidate) => message.startsWith(candidate)) ?? 'MAIL_API_INTERNAL';
  const status = ['MESSAGE_CHANGED', 'DRAFT_CONFLICT', 'MAIL_IN_PROGRESS', 'FIRST_CONTACT_STAGE', 'FIRST_CONTACT_ALREADY_SENT', 'FIRST_CONTACT_RESEND'].includes(code)
    ? 409
    : ['NOT_FOUND', 'FIRST_CONTACT_MAILBOX'].includes(code)
    ? 404
    : ['FIRST_CONTACT_INVALID_EMAIL', 'FIRST_CONTACT_INCOMPLETE'].includes(code)
    ? 422
    : code.startsWith('INVALID') || code.includes('TOO_LARGE')
    ? 400
    : 500;
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
      if (new TextEncoder().encode(text).byteLength > 25 * 1024 * 1024) return json(request, { ok: false, error: 'PAYLOAD_TOO_LARGE' }, 413);
      const body = JSON.parse(text) as Record<string, unknown>;
      if (!body || typeof body !== 'object' || Array.isArray(body) || !ACTIONS.has(String(body.action ?? ''))) return json(request, { ok: false, error: 'INVALID_ACTION' }, 400);
      return json(request, { ok: true, data: await dependencies.execute(userId, body) }, 200);
    } catch (error) {
      if (error instanceof SyntaxError) return json(request, { ok: false, error: 'INVALID_JSON' }, 400);
      const translated = publicError(error);
      return json(request, { ok: false, error: translated.code }, translated.status);
    }
  };
}
