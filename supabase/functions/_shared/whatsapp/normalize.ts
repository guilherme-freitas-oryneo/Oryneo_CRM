export type NormalizedInboundMessage = {
  providerMessageId: string;
  customerWaId: string;
  customerName: string | null;
  kind: 'text' | 'audio' | 'image' | 'document' | 'video' | 'other';
  body: string;
  mediaId: string | null;
  mimeType: string | null;
  occurredAt: string;
};

export type NormalizedDeliveryStatus = {
  providerMessageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  occurredAt: string;
};

export type NormalizedWhatsAppEvent = {
  messages: NormalizedInboundMessage[];
  statuses: NormalizedDeliveryStatus[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function clean(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{10}$/.test(value)) return null;
  const milliseconds = Number(value) * 1000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < Date.UTC(2020, 0, 1) || milliseconds > Date.now() + 86_400_000) return null;
  return new Date(milliseconds).toISOString();
}

/** Accept only events for the configured account and sender. Never infer a CRM lead from a phone. */
export function normalizeWhatsAppWebhook(payload: unknown, expectedAccountId: string, expectedPhoneNumberId: string): NormalizedWhatsAppEvent {
  const normalized: NormalizedWhatsAppEvent = { messages: [], statuses: [] };
  const root = record(payload);
  if (root?.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return normalized;
  for (const rawEntry of root.entry) {
    const entry = record(rawEntry);
    if (entry?.id !== expectedAccountId || !Array.isArray(entry.changes)) continue;
    for (const rawChange of entry.changes) {
      const change = record(rawChange);
      const value = record(change?.value);
      if (change?.field !== 'messages' || !value || record(value.metadata)?.phone_number_id !== expectedPhoneNumberId) continue;
      const names = new Map<string, string>();
      if (Array.isArray(value.contacts)) for (const rawContact of value.contacts) {
        const contact = record(rawContact);
        const waId = clean(contact?.wa_id, 32);
        const name = clean(record(contact?.profile)?.name, 160);
        if (waId && name) names.set(waId, name);
      }
      if (Array.isArray(value.messages)) for (const rawMessage of value.messages) {
        const message = record(rawMessage);
        const providerMessageId = clean(message?.id, 200);
        const customerWaId = clean(message?.from, 32);
        const occurredAt = timestamp(message?.timestamp);
        if (!providerMessageId || !customerWaId || !/^\d{8,32}$/.test(customerWaId) || !occurredAt) continue;
        const type = message?.type;
        const kind = type === 'text' || type === 'audio' || type === 'image' || type === 'document' || type === 'video' ? type : 'other';
        const content = record(message?.[kind]);
        const body = (clean(kind === 'text' ? content?.body : kind === 'image' || kind === 'document' || kind === 'video' ? content?.caption : null, 4096) ?? '');
        normalized.messages.push({
          providerMessageId, customerWaId, customerName: names.get(customerWaId) ?? null,
          kind, body, mediaId: clean(content?.id, 200), mimeType: clean(content?.mime_type, 120), occurredAt,
        });
      }
      if (Array.isArray(value.statuses)) for (const rawStatus of value.statuses) {
        const status = record(rawStatus);
        const providerMessageId = clean(status?.id, 200);
        const occurredAt = timestamp(status?.timestamp);
        if (!providerMessageId || !occurredAt || !['sent', 'delivered', 'read', 'failed'].includes(String(status?.status))) continue;
        normalized.statuses.push({ providerMessageId, status: status?.status as NormalizedDeliveryStatus['status'], occurredAt });
      }
    }
  }
  return normalized;
}
