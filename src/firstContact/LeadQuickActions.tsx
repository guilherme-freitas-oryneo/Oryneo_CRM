import { MessageCircle } from 'lucide-react';
import type { DealRow, StageRow } from '../data';
import { buildWhatsAppUrl } from './whatsapp';

export const FIRST_CONTACT_STAGE_ID = '87f1e31e-3912-40b0-9284-c6805c84dafe';

export function LeadQuickActions({ deal, stage, onOpenWhatsApp }: {
  deal: DealRow;
  stage: StageRow;
  onOpenWhatsApp(url: string): void;
}) {
  if (stage.id !== FIRST_CONTACT_STAGE_ID) return null;
  const whatsappUrl = buildWhatsAppUrl(deal.data.phone);
  if (!whatsappUrl) return null;
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();

  return <div className="lead-quick-actions" draggable={false} onPointerDown={stop} onDragStart={event => { event.preventDefault(); event.stopPropagation(); }}>
    <button type="button" onClick={event => { stop(event); onOpenWhatsApp(whatsappUrl); }} aria-label={`Abrir WhatsApp de ${deal.data.contact || deal.data.company || 'contato'}`}><MessageCircle size={13}/>WhatsApp</button>
  </div>;
}
