import { assertEquals } from 'jsr:@std/assert@1';
import { buildOutboundMessage } from '../_shared/whatsapp/outboundMessage.ts';

Deno.test('builds a quoted text reply without changing the recipient', () => {
  assertEquals(buildOutboundMessage({
    to: '5521999998888',
    kind: 'text',
    text: 'Vou verificar.',
    replyToProviderMessageId: 'wamid.inbound-1',
  }), {
    to: '5521999998888',
    type: 'text',
    context: { message_id: 'wamid.inbound-1' },
    text: { body: 'Vou verificar.', preview_url: false },
  });
});

Deno.test('builds a reaction to an existing message', () => {
  assertEquals(buildOutboundMessage({
    to: '5521999998888',
    kind: 'reaction',
    reactionToProviderMessageId: 'wamid.inbound-1',
    reactionEmoji: '👍',
  }), {
    to: '5521999998888',
    type: 'reaction',
    reaction: { message_id: 'wamid.inbound-1', emoji: '👍' },
  });
});

Deno.test('rejects malformed provider ids and unsupported reaction values', () => {
  for (const input of [
    { to: '5521999998888', kind: 'text' as const, text: 'Oi', replyToProviderMessageId: 'bad id' },
    { to: '5521999998888', kind: 'reaction' as const, reactionToProviderMessageId: 'wamid.ok', reactionEmoji: 'texto' },
  ]) {
    let failed = false;
    try { buildOutboundMessage(input); } catch { failed = true; }
    assertEquals(failed, true);
  }
});
