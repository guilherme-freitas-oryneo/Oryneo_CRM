export type IntakeMailWorkerResult = { claimed: number; sent: number; failed: number };

export type IntakeMailWorkerHandlerDependencies = {
  verifyToken(token: string): Promise<boolean>;
  process(): Promise<IntakeMailWorkerResult>;
};

export function createIntakeMailWorkerHandler(dependencies: IntakeMailWorkerHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    if (request.method !== 'POST') return new Response(JSON.stringify({ ok: false }), { status: 405, headers });
    const token = request.headers.get('x-oryneo-cron') ?? '';
    if (!token || !await dependencies.verifyToken(token)) {
      return new Response(JSON.stringify({ ok: false }), { status: 401, headers });
    }
    try {
      const result = await dependencies.process();
      return new Response(JSON.stringify({ ok: true, ...result }), { status: 200, headers });
    } catch {
      return new Response(JSON.stringify({ ok: false }), { status: 503, headers });
    }
  };
}
