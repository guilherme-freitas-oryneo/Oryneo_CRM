export function buildWhatsAppUrl(phone: string): string | null {
  const source = phone.trim();
  const digits = source.replace(/\D/g, '');
  if (source.startsWith('+')) {
    return digits.length >= 10 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
  }
  if (!/^\d|^\(/.test(source) || ![10, 11].includes(digits.length)) return null;
  return `https://wa.me/55${digits}`;
}
