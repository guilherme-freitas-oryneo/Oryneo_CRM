/**
 * Endereços públicos do CRM — transição reversível GitHub Pages -> domínio ORYNEO.
 * Nenhuma variável definida implica preservar as URLs antigas.
 * Somente um valor EXATO ativa o novo endereço; não confiar em Origin/Host de entrada.
 */
export const LEGACY_CRM_BASE = 'https://guilherme-freitas-oryneo.github.io/Oryneo_CRM';
export const CUSTOM_CRM_BASE = 'https://crm.oryneo.com.br';

export function crmPublicBase(configured?: string | null): string {
  return configured === CUSTOM_CRM_BASE ? CUSTOM_CRM_BASE : LEGACY_CRM_BASE;
}

export function crmPublicUrl(path: string, configured?: string | null): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[\r\n]/.test(path)) {
    throw new Error('CRM_PUBLIC_PATH_INVALID');
  }
  return crmPublicBase(configured) + path;
}
