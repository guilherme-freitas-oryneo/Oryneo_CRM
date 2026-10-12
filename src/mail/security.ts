import DOMPurify from 'dompurify';

const SAFE_URI = /^(?:(?:https?|mailto|tel|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i;

export function sanitizeMailHtml(html: string, allowRemoteImages: boolean, cidMap: Record<string, string> = {}): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  template.content.querySelectorAll('img').forEach((image) => {
    const source = image.getAttribute('src')?.trim() ?? '';
    if (/^cid:/i.test(source)) {
      const cid = source.slice(4).replace(/^<|>$/g, '');
      if (cidMap[cid]) image.setAttribute('src', cidMap[cid]);
      else image.removeAttribute('src');
    } else if (/^(?:https?:)?\/\//i.test(source) && !allowRemoteImages) {
      image.setAttribute('data-remote-src', source);
      image.removeAttribute('src');
      image.setAttribute('alt', image.getAttribute('alt') || 'Imagem remota bloqueada');
    }
  });

  const clean = DOMPurify.sanitize(template.innerHTML, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'option', 'iframe', 'object', 'embed', 'meta', 'base'],
    FORBID_ATTR: ['srcdoc'],
    ADD_ATTR: ['data-remote-src', 'target', 'rel'],
    ALLOWED_URI_REGEXP: SAFE_URI,
    SANITIZE_NAMED_PROPS: true,
  });
  const result = document.createElement('template');
  result.innerHTML = clean;
  result.content.querySelectorAll('a[href]').forEach((link) => {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
  return result.innerHTML;
}
