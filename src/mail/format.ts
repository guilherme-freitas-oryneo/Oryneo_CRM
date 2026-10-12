import type { MailAddress } from './types';

const replyPrefix = /^\s*(?:(?:re|res|resp|fw|fwd|enc|rv)(?:\[\d+\])?\s*:\s*)+/iu;

export function normalizeSubject(subject: string): string {
  return subject
    .replace(replyPrefix, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

export function participantLabel(participant: MailAddress): string {
  const name = participant.name?.trim();
  if (name) return name;
  const address = participant.address.trim();
  if (!address.includes('@')) return 'Desconhecido';
  return address.slice(0, address.indexOf('@')) || 'Desconhecido';
}

export function formatMailDate(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  if (date.getFullYear() !== now.getFullYear()) {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
    .format(date)
    .replace(' de ', ' ')
    .replace('.', '')
    .replace(/^0/, '');
}
