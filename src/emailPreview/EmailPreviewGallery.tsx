import { useMemo, useState } from 'react';
import { renderFirstContactEmail } from '../mail/firstContactTemplates';
import { firstContactScenarios } from './fixtures';
import './emailPreview.css';

type Device = 'desktop' | 'mobile';
type Format = 'html' | 'text';

export function EmailPreviewGallery() {
  const [selectedId, setSelectedId] = useState(firstContactScenarios[0].id);
  const [device, setDevice] = useState<Device>('desktop');
  const [format, setFormat] = useState<Format>('html');
  const scenario = firstContactScenarios.find((item) => item.id === selectedId) ?? firstContactScenarios[0];
  const email = useMemo(() => renderFirstContactEmail(scenario.input), [scenario]);

  return (
    <main className="email-preview-app">
      <aside className="email-preview-sidebar">
        <div className="email-preview-brand">
          <img src="/oryneo-wordmark-mono-reverse.png" alt="ORYNEO" />
          <span>Laboratório de e-mails</span>
        </div>
        <div className="email-preview-heading">
          <span className="email-preview-kicker">Lote 1 · protótipos</span>
          <h1>Primeiro contato</h1>
          <p>Dois modelos mestres aplicados a oito cenários reais do formulário.</p>
        </div>
        <nav aria-label="Cenários de e-mail" className="email-preview-scenarios">
          {firstContactScenarios.map((item, index) => (
            <button
              type="button"
              key={item.id}
              className={item.id === scenario.id ? 'is-active' : ''}
              onClick={() => setSelectedId(item.id)}
              aria-label={`Cenário ${index + 1}: ${item.label}`}
            >
              <span>{item.label}</span>
              <small>{item.note}</small>
            </button>
          ))}
        </nav>
      </aside>

      <section className="email-preview-workspace">
        <header className="email-preview-toolbar">
          <div>
            <span className="email-preview-label">Assunto</span>
            <strong>{email.subject}</strong>
            <small>Preheader: {email.preheader}</small>
          </div>
          <div className="email-preview-controls">
            <div className="email-preview-segment" aria-label="Formato">
              <button type="button" className={format === 'html' ? 'is-active' : ''} onClick={() => setFormat('html')}>HTML</button>
              <button type="button" className={format === 'text' ? 'is-active' : ''} onClick={() => setFormat('text')}>Texto simples</button>
            </div>
            <div className="email-preview-segment" aria-label="Dispositivo">
              <button type="button" className={device === 'desktop' ? 'is-active' : ''} onClick={() => setDevice('desktop')}>Desktop</button>
              <button type="button" className={device === 'mobile' ? 'is-active' : ''} onClick={() => setDevice('mobile')}>Mobile</button>
            </div>
          </div>
        </header>

        <div className="email-preview-stage">
          {format === 'html' ? (
            <div data-testid="email-frame-shell" className={`email-frame-shell ${device === 'mobile' ? 'is-mobile' : ''}`}>
              <iframe title="Prévia do e-mail" srcDoc={email.html} />
            </div>
          ) : (
            <pre className={`email-text-preview ${device === 'mobile' ? 'is-mobile' : ''}`}>{email.text}</pre>
          )}
        </div>
      </section>
    </main>
  );
}
