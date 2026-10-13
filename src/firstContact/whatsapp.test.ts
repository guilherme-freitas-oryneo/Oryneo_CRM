import { describe, expect, it } from 'vitest';
import { buildWhatsAppUrl } from './whatsapp';

describe('buildWhatsAppUrl', () => {
  it.each([
    ['(11) 99999-8888', 'https://wa.me/5511999998888'],
    ['11 3333-2222', 'https://wa.me/551133332222'],
    ['+55 (11) 99999-8888', 'https://wa.me/5511999998888'],
    ['+1 415 555 2671', 'https://wa.me/14155552671'],
  ])('normaliza %s sem inventar outro país', (phone, expected) => {
    expect(buildWhatsAppUrl(phone)).toBe(expected);
  });

  it.each(['', '12345', '0011 99999-8888', '+123', 'texto'])('recusa número ambíguo ou inválido: %s', phone => {
    expect(buildWhatsAppUrl(phone)).toBeNull();
  });
});
