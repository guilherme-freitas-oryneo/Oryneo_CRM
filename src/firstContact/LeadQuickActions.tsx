import { Check, MessageCircle, Send } from 'lucide-react';
import type { DealRow, StageRow } from '../data';
import { buildWhatsAppUrl } from './whatsapp';

export const FIRST_CONTACT_STAGE_ID = '87f1e31e-3912-40b0-9284-c6805c84dafe';

const validEmail = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value.trim()) && !/[\r\n\0]/.test(value);

export function LeadQuickActions({ deal, stage, onPreview, onOpenWhatsApp }: {
  deal: DealRow;
  stage: StageRow;
  onPreview(deal: DealRow): void;
  onOpenWhatsApp(url: string): void;
}) {
  if (stage.id !== FIRST_CONTACT_STAGE_ID) return null;
  const whatsappUrl = buildWhatsAppUrl(deal.data.phone);
  const sentAt = deal.data.first_contact?.sent_at;
  if (!validEmail(deal.data.email) && !whatsappUrl && !sentAt) return null;
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  const sentTitle = sentAt
    ? `E-mail enviado em ${new Date(sentAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
    : '';

  return <div className="lead-quick-actions" draggable={false} onPointerDown={stop} onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}>
    {sentAt
      ? <span className="lead-contact-sent" title={sentTitle}><Check size={12}/>E-mail enviado</span>
      : validEmail(deal.data.email) && <button type="button" onClick={event => { stop(event); onPreview(deal); }} aria-label="Revisar primeiro e-mail"><Send size={13}/>Enviar e-mail</button>}
    {whatsappUrl && <button type="button" onClick={event => { stop(event); onOpenWhatsApp(whatsappUrl); }} aria-label={`Abrir WhatsApp de ${deal.data.contact || deal.data.company || 'contato'}`}><MessageCircle size={13}/>WhatsApp</button>}
  </div>;
}
