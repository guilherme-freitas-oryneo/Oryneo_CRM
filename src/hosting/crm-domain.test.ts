import { describe, expect, it } from 'vitest';
import { crmPublicBase, crmPublicUrl, CUSTOM_CRM_BASE, LEGACY_CRM_BASE } from '../../supabase/functions/_shared/hosting/crm-urls';

describe('ORYNEO CRM custom domain — migration safety', () => {
  it('preserves legacy links when not explicitly switched', () => {
    expect(crmPublicBase()).toBe(LEGACY_CRM_BASE);
    expect(crmPublicUrl('/pagar/?token=xyz')).toBe(LEGACY_CRM_BASE + '/pagar/?token=xyz');
  });

  it('switches to custom domain only on exact authorized configuration', () => {
    expect(crmPublicBase(CUSTOM_CRM_BASE)).toBe(CUSTOM_CRM_BASE);
    expect(crmPublicUrl('/proposta/?token=xyz', CUSTOM_CRM_BASE)).toBe(CUSTOM_CRM_BASE + '/proposta/?token=xyz');
  });

  it('fails closed on malformed, deceptive and arbitrary configuration values', () => {
    expect(crmPublicBase('https://crm.oryneo.com.br.evil.example')).toBe(LEGACY_CRM_BASE);
    expect(crmPublicBase('https://CRM.oryneo.com.br/')).toBe(LEGACY_CRM_BASE);
    expect(crmPublicBase('http://crm.oryneo.com.br')).toBe(LEGACY_CRM_BASE);
    expect(() => crmPublicUrl('//evil.example/')).toThrow('CRM_PUBLIC_PATH_INVALID');
    expect(() => crmPublicUrl('https://evil.example')).toThrow('CRM_PUBLIC_PATH_INVALID');
    expect(() => crmPublicUrl('/pagar/\nHeader: injected')).toThrow('CRM_PUBLIC_PATH_INVALID');
  });

  it('generates safely encoded links with identical paths in both environments', () => {
    const path = '/pagar/?token=' + encodeURIComponent('id+a?b=c') + '&retorno=1';
    expect(crmPublicUrl(path, CUSTOM_CRM_BASE)).toBe('https://crm.oryneo.com.br' + path);
    expect(crmPublicUrl(path)).toBe('https://guilherme-freitas-oryneo.github.io/Oryneo_CRM' + path);
  });
});
