import { useMemo, useRef, useState } from 'react';
import { Check, Send } from 'lucide-react';
import { Modal, Spinner } from '../components';
import type { DealRow } from '../data';
import { renderFirstContactEmail, type AddOn, type BillingCycle, type ContactIntent } from '../mail/firstContactTemplates';
import { sendFirstContact } from './api';

const LOGO_URL = 'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM/oryneo-wordmark-mono.png';
const plans = new Set(['Start', 'Growth', 'Scale']);
const cycles = new Set(['monthly', 'annual']);

function previewFor(deal: DealRow) {
  const quote = deal.data.quote;
  const submission = deal.data.form_submission;
  const intent = (submission?.intent === 'contract' ? 'contract' : 'conversation') as ContactIntent;
  const hasValidSelection = Boolean(quote && plans.has(quote.plan) && cycles.has(quote.cycle));
  if (!hasValidSelection && (intent === 'contract' || quote)) return null;
  return renderFirstContactEmail({
    intent,
    firstName: deal.data.contact.trim().split(/\s+/)[0],
    company: deal.data.company.trim(),
    plan: hasValidSelection ? quote!.plan as 'Start' | 'Growth' | 'Scale' : undefined,
    cycle: hasValidSelection ? quote!.cycle as BillingCycle : undefined,
    addOns: hasValidSelection ? quote!.addons.map(item => item.key).filter((key): key is AddOn => key === 'landing-page' || key === 'traffic') : [],
    goals: submission?.goals,
    primaryGoal: submission?.primary_goal,
    acquisitionChannels: submission?.acquisition_channels,
    primaryAcquisitionChannel: submission?.primary_acquisition_channel,
    acquisitionChannel: submission?.acquisition_channel,
    logoUrl: LOGO_URL,
  });
}

export function FirstContactDialog({ deal, resend = false, onClose, onSent }: {
  deal: DealRow;
  resend?: boolean;
  onClose(): void;
  onSent(): Promise<void> | void;
}) {
  const rendered = useMemo(() => previewFor(deal), [deal]);
  const idempotencyKey = useRef(crypto.randomUUID());
  const busyRef = useRef(false);
  const [mode, setMode] = useState<'html' | 'text'>('html');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [sent, setSent] = useState(false);
  const submit = async () => {
    if (busyRef.current || !rendered) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      await sendFirstContact({ dealId: deal.id, idempotencyKey: idempotencyKey.current, resend });
      setSent(true);
      await onSent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível enviar agora.');
    } finally {
      busyRef.current = false; setBusy(false);
    }
  };

  return <Modal wide title={resend ? 'Revisar reenvio' : 'Revisar primeiro e-mail'} description="Confira exatamente o que o lead receberá antes de confirmar." onClose={() => !busy && onClose()}>
    {!rendered ? <p className="first-contact-error" role="alert">Faltam dados da seleção comercial para gerar uma prévia segura.</p> : <div className="first-contact-dialog">
      <dl className="first-contact-meta"><div><dt>Para</dt><dd>{deal.data.email}</dd></div><div><dt>Assunto</dt><dd>{rendered.subject}</dd></div></dl>
      <div className="first-contact-modes" role="group" aria-label="Formato da prévia">
        <button type="button" className={mode === 'html' ? 'active' : ''} onClick={() => setMode('html')} aria-pressed={mode === 'html'}>Visual</button>
        <button type="button" className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')} aria-pressed={mode === 'text'} aria-label="Ver versão em texto">Texto</button>
      </div>
      <div className="first-contact-preview">{mode === 'html'
        ? <iframe title="Prévia HTML do primeiro e-mail" sandbox="" srcDoc={rendered.html}/>
        : <pre>{rendered.text}</pre>}
      </div>
      <p className="first-contact-note">O envio será feito por contato@oryneo.com.br em versões HTML e texto. O lead continuará nesta etapa.</p>
      {error && <p className="first-contact-error" role="alert">{error}</p>}
      {sent && <p className="first-contact-success" role="status"><Check size={15}/>E-mail enviado.</p>}
      <footer className="first-contact-actions"><button type="button" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="primary" disabled={busy || sent} onClick={() => void submit()} aria-label={error ? 'Tentar envio novamente' : resend ? 'Confirmar reenvio de e-mail' : 'Confirmar e enviar e-mail'}>{busy ? <Spinner/> : <Send size={15}/>} {error ? 'Tentar novamente' : resend ? 'Confirmar reenvio' : 'Confirmar e enviar'}</button></footer>
    </div>}
  </Modal>;
}
