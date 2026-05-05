/** In-memory / pre-save filesystem staging token (not persisted to DB until sync). */
export const BOOKS_STAGED_PREFIX = 'books-staged:';

export function isBooksStagedRef(value: string | null | undefined): boolean {
  return (
    typeof value === 'string' &&
    value.length > BOOKS_STAGED_PREFIX.length &&
    value.startsWith(BOOKS_STAGED_PREFIX)
  );
}

function textEncodeUtf8(value: string): Uint8Array {
  const E = (globalThis as { TextEncoder?: typeof TextEncoder | undefined })
    ?.TextEncoder;
  if (E) {
    return new E().encode(value);
  }
  const B = (globalThis as { Buffer?: typeof Buffer | undefined })?.Buffer;
  if (B) {
    return new Uint8Array(B.from(value, 'utf8'));
  }
  throw new Error('[books] UTF-8 encoder unavailable (missing TextEncoder and Buffer)');
}

function textDecodeUtf8(bytes: Uint8Array): string {
  const D = (globalThis as { TextDecoder?: typeof TextDecoder | undefined })
    ?.TextDecoder;
  if (D) {
    return new D('utf-8').decode(bytes);
  }
  const B = (globalThis as { Buffer?: typeof Buffer | undefined })?.Buffer;
  if (B) {
    return B.from(bytes).toString('utf8');
  }
  throw new Error('[books] UTF-8 decoder unavailable (missing TextDecoder and Buffer)');
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let out = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    out += String.fromCharCode(...chunk);
  }
  return out;
}

function binaryStringToBytes(bin: string): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i) & 0xff;
  }
  return out;
}

export function encodeBooksStagedPath(absolutePath: string): string {
  // eslint-disable-next-line no-undef
  if (typeof btoa === 'function') {
    const bytes = textEncodeUtf8(absolutePath);
    return BOOKS_STAGED_PREFIX + btoa(bytesToBinaryString(bytes));
  }
  const B = (globalThis as { Buffer?: typeof Buffer | undefined })?.Buffer;
  if (B) {
    return (
      BOOKS_STAGED_PREFIX +
      B.from(textEncodeUtf8(absolutePath)).toString('base64')
    );
  }
  throw new Error(
    '[books] encodeBooksStagedPath: no base64 encoder available (missing btoa and Buffer)'
  );
}

export function decodeBooksStagedPath(ref: string): string | null {
  if (!isBooksStagedRef(ref)) {
    return null;
  }
  const b64 = ref.slice(BOOKS_STAGED_PREFIX.length);
  try {
    // eslint-disable-next-line no-undef
    if (typeof atob === 'function') {
      const bin = atob(b64);
      return textDecodeUtf8(binaryStringToBytes(bin));
    }
  } catch {
    return null;
  }
  const B = (globalThis as { Buffer?: typeof Buffer | undefined })?.Buffer;
  if (B) {
    try {
      return textDecodeUtf8(new Uint8Array(B.from(b64, 'base64')));
    } catch {
      return null;
    }
  }
  return null;
}
