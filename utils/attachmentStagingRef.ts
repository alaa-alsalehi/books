/** In-memory / pre-save filesystem staging token (not persisted to DB until sync). */
export const BOOKS_STAGED_PREFIX = 'books-staged:';

export function isBooksStagedRef(value: string | null | undefined): boolean {
  return (
    typeof value === 'string' &&
    value.length > BOOKS_STAGED_PREFIX.length &&
    value.startsWith(BOOKS_STAGED_PREFIX)
  );
}

export function encodeBooksStagedPath(absolutePath: string): string {
  const bin = unescape(encodeURIComponent(absolutePath));
  // eslint-disable-next-line no-undef
  if (typeof btoa === 'function') {
    return BOOKS_STAGED_PREFIX + btoa(bin);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any)?.Buffer;
  if (B) {
    return BOOKS_STAGED_PREFIX + B.from(absolutePath, 'utf8').toString('base64');
  }
  return BOOKS_STAGED_PREFIX + bin;
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
      return decodeURIComponent(escape(bin));
    }
  } catch {
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any)?.Buffer;
  if (B) {
    try {
      return B.from(b64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }
  return null;
}
