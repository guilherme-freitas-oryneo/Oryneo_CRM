const decoder = new TextDecoder();

export type ImapFrame = { line: string; literal?: Uint8Array };
export type ImapListEntry = { attributes: string[]; delimiter: string | null; name: string };
export type ImapSelectState = { exists: number; recent: number; uidValidity: number; uidNext: number; highestModSeq: number | null };
export type ImapFetchedMessage = { sequence: number; uid: number; flags: string[]; size: number; raw: Uint8Array };

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (!left.length) return right.slice();
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left);
  joined.set(right, left.length);
  return joined;
}

function crlfIndex(bytes: Uint8Array): number {
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) return index;
  }
  return -1;
}

export class ImapFrameReader {
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
  #pendingLine: string | null = null;
  #pendingLiteralLength = 0;

  constructor(private readonly maxLiteralBytes = 25 * 1024 * 1024) {}

  push(chunk: Uint8Array): ImapFrame[] {
    this.#buffer = concatBytes(this.#buffer, chunk);
    const frames: ImapFrame[] = [];
    while (true) {
      if (this.#pendingLine !== null) {
        if (this.#buffer.length < this.#pendingLiteralLength) break;
        frames.push({
          line: this.#pendingLine,
          literal: this.#buffer.slice(0, this.#pendingLiteralLength),
        });
        this.#buffer = this.#buffer.slice(this.#pendingLiteralLength);
        this.#pendingLine = null;
        this.#pendingLiteralLength = 0;
        continue;
      }
      const end = crlfIndex(this.#buffer);
      if (end < 0) break;
      const line = decoder.decode(this.#buffer.slice(0, end));
      this.#buffer = this.#buffer.slice(end + 2);
      const literal = line.match(/\{(\d+)\+?\}$/);
      if (!literal) {
        frames.push({ line });
        continue;
      }
      const length = Number(literal[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > this.maxLiteralBytes) {
        throw new Error('Literal excede o limite seguro.');
      }
      this.#pendingLine = line;
      this.#pendingLiteralLength = length;
    }
    return frames;
  }
}

export function quoteImap(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error('Valor IMAP inválido.');
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function unquoteImap(value: string): string | null {
  if (value.toUpperCase() === 'NIL') return null;
  if (!value.startsWith('"') || !value.endsWith('"')) return value;
  return value.slice(1, -1).replace(/\\([\\"])/g, '$1');
}

export function parseListResponse(line: string): ImapListEntry | null {
  const match = line.match(/^\* LIST \(([^)]*)\) (NIL|"(?:[^"\\]|\\.)*") ("(?:[^"\\]|\\.)*"|\S+)$/i);
  if (!match) return null;
  return {
    attributes: match[1].trim() ? match[1].trim().split(/\s+/) : [],
    delimiter: unquoteImap(match[2]),
    name: unquoteImap(match[3]) ?? '',
  };
}

export function parseSelectState(lines: string[]): ImapSelectState {
  const readNumber = (pattern: RegExp, fallback = 0) => {
    for (const line of lines) {
      const match = line.match(pattern);
      if (match) return Number(match[1]);
    }
    return fallback;
  };
  const highestModSeq = readNumber(/\[HIGHESTMODSEQ (\d+)\]/i, -1);
  return {
    exists: readNumber(/^\* (\d+) EXISTS$/i),
    recent: readNumber(/^\* (\d+) RECENT$/i),
    uidValidity: readNumber(/\[UIDVALIDITY (\d+)\]/i),
    uidNext: readNumber(/\[UIDNEXT (\d+)\]/i),
    highestModSeq: highestModSeq < 0 ? null : highestModSeq,
  };
}

export function parseFetchFrames(frames: ImapFrame[]): ImapFetchedMessage[] {
  const messages: ImapFetchedMessage[] = [];
  for (const frame of frames) {
    if (!frame.literal) continue;
    const sequence = frame.line.match(/^\* (\d+) FETCH /i);
    const uid = frame.line.match(/\bUID (\d+)\b/i);
    const flags = frame.line.match(/\bFLAGS \(([^)]*)\)/i);
    const size = frame.line.match(/\bRFC822\.SIZE (\d+)\b/i);
    if (!sequence || !uid) continue;
    messages.push({
      sequence: Number(sequence[1]),
      uid: Number(uid[1]),
      flags: flags?.[1].trim() ? flags[1].trim().split(/\s+/) : [],
      size: size ? Number(size[1]) : frame.literal.length,
      raw: frame.literal,
    });
  }
  return messages;
}
