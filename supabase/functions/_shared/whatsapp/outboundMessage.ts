export type OutboundMessageInput =
  | { to: string; kind: 'text'; text: string; replyToProviderMessageId?: string | null }
  | { to: string; kind: 'audio' | 'image' | 'document' | 'video'; mediaId: string; text?: string; filename?: string; voice?: boolean; replyToProviderMessageId?: string | null }
  | { to: string; kind: 'reaction'; reactionToProviderMessageId: string; reactionEmoji: string };

const allowedReactions = new Set(['👍', '❤️', '😂', '😮', '😢', '🙏']);

export function validProviderMessageId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200 && !/\s/.test(value);
}

export function validReactionEmoji(value: unknown): value is string {
  return typeof value === 'string' && allowedReactions.has(value);
}

export function buildOutboundMessage(input: OutboundMessageInput): Record<string, unknown> {
  if (!/^\d{8,32}$/.test(input.to)) throw new Error('INVALID_RECIPIENT');
  if (input.kind === 'reaction') {
    if (!validProviderMessageId(input.reactionToProviderMessageId) || !validReactionEmoji(input.reactionEmoji)) {
      throw new Error('INVALID_REACTION');
    }
    return { to: input.to, type: 'reaction', reaction: { message_id: input.reactionToProviderMessageId, emoji: input.reactionEmoji } };
  }
  if (input.replyToProviderMessageId != null && !validProviderMessageId(input.replyToProviderMessageId)) throw new Error('INVALID_REPLY');
  const context = input.replyToProviderMessageId ? { context: { message_id: input.replyToProviderMessageId } } : {};
  if (input.kind === 'text') {
    const text = input.text.trim();
    if (!text || text.length > 4096) throw new Error('INVALID_TEXT');
    return { to: input.to, type: 'text', ...context, text: { body: text, preview_url: false } };
  }
  if (!validProviderMessageId(input.mediaId)) throw new Error('INVALID_MEDIA');
  const media = {
    id: input.mediaId,
    ...(input.text && input.kind !== 'audio' ? { caption: input.text } : {}),
    ...(input.kind === 'document' && input.filename ? { filename: input.filename } : {}),
    ...(input.kind === 'audio' && input.voice ? { voice: true } : {}),
  };
  return { to: input.to, type: input.kind, ...context, [input.kind]: media };
}
