export type AiProvider = 'openai' | 'anthropic';
export type AiMessage = { role: 'user' | 'assistant'; content: string };
export type AiRequest = { provider: AiProvider; apiKey: string; model: string; systemPrompt: string; messages: AiMessage[] };
export type AiReplyResult = { text: string; providerResponseId: string | null };

export type AiProviderErrorCode =
  | 'AI_CONFIGURATION_INVALID'
  | 'AI_INCOMPLETE_MAX_OUTPUT_TOKENS'
  | 'AI_INCOMPLETE'
  | 'AI_EMPTY_RESPONSE'
  | 'AI_PROVIDER_RATE_LIMITED'
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_PROVIDER_AUTH'
  | 'AI_PROVIDER_REQUEST'
  | 'AI_PROVIDER_TIMEOUT'
  | 'AI_PROVIDER_INVALID_RESPONSE';

export class AiProviderError extends Error {
  constructor(
    public readonly code: AiProviderErrorCode,
    public readonly retryable: boolean,
    public readonly status: number | null = null,
    public readonly providerResponseId: string | null = null,
  ) {
    super(code);
    this.name = 'AiProviderError';
  }
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const clean = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 4096) : '';
const responseId = (payload: Record<string, unknown>) => clean(payload.id).slice(0, 200) || null;

function httpError(status: number): AiProviderError {
  if (status === 429) return new AiProviderError('AI_PROVIDER_RATE_LIMITED', true, status);
  if (status >= 500) return new AiProviderError('AI_PROVIDER_UNAVAILABLE', true, status);
  if (status === 401 || status === 403) return new AiProviderError('AI_PROVIDER_AUTH', false, status);
  return new AiProviderError('AI_PROVIDER_REQUEST', false, status);
}

function openAiText(payload: Record<string, unknown>): string {
  const direct = clean(payload.output_text);
  if (direct) return direct;
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = typeof item === 'object' && item && Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const block of content) {
      const text = clean(typeof block === 'object' && block ? (block as { text?: unknown }).text : '');
      if (text) return text;
    }
  }
  return '';
}

function anthropicText(payload: Record<string, unknown>): string {
  const content = Array.isArray(payload.content) ? payload.content : [];
  for (const block of content) {
    if (typeof block === 'object' && block && (block as { type?: unknown }).type === 'text') {
      const text = clean((block as { text?: unknown }).text);
      if (text) return text;
    }
  }
  return '';
}

export async function requestAiReply(input: AiRequest, fetcher: Fetcher = fetch): Promise<AiReplyResult> {
  if (!input.apiKey || !input.model || !input.systemPrompt || !input.messages.length) {
    throw new AiProviderError('AI_CONFIGURATION_INVALID', false);
  }
  const endpoint = input.provider === 'openai' ? 'https://api.openai.com/v1/responses' : 'https://api.anthropic.com/v1/messages';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const body = input.provider === 'openai'
    ? { model: input.model, instructions: input.systemPrompt, input: input.messages, max_output_tokens: 500 }
    : { model: input.model, system: input.systemPrompt, messages: input.messages, max_tokens: 500 };
  if (input.provider === 'openai') headers.Authorization = `Bearer ${input.apiKey}`;
  else {
    headers['x-api-key'] = input.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }

  let response: Response;
  try {
    response = await fetcher(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new AiProviderError('AI_PROVIDER_TIMEOUT', true);
    }
    throw error;
  }
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) throw httpError(response.status);
  if (!payload) throw new AiProviderError('AI_PROVIDER_INVALID_RESPONSE', true, response.status);

  const providerResponseId = responseId(payload);
  if (input.provider === 'openai' && payload.status === 'incomplete') {
    const details = typeof payload.incomplete_details === 'object' && payload.incomplete_details
      ? payload.incomplete_details as { reason?: unknown }
      : null;
    const code = details?.reason === 'max_output_tokens' ? 'AI_INCOMPLETE_MAX_OUTPUT_TOKENS' : 'AI_INCOMPLETE';
    throw new AiProviderError(code, true, response.status, providerResponseId);
  }

  const text = input.provider === 'openai' ? openAiText(payload) : anthropicText(payload);
  if (!text) throw new AiProviderError('AI_EMPTY_RESPONSE', true, response.status, providerResponseId);
  return { text, providerResponseId };
}
