function uint8ArrayToBase64(bytes: Uint8Array): string | null {
  try {
    // Browser/Electron renderer
    // eslint-disable-next-line no-undef
    if (typeof btoa === 'function') {
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      // eslint-disable-next-line no-undef
      return btoa(binary);
    }
  } catch (err) {
    // best-effort; fallback to Buffer path below
    console.warn(
      '[books] attachment encoding failed using btoa/String.fromCharCode',
      err
    );
  }

  // Fallback (Node-like)
  const B = (globalThis as { Buffer?: typeof Buffer | undefined })?.Buffer;
  if (B) {
    try {
      return B.from(bytes).toString('base64');
    } catch (err) {
      console.warn('[books] attachment encoding failed using Buffer', err);
      return null;
    }
  }
  return null;
}

export function dataUrlFromBytes(type: string, bytes: Uint8Array): string | null {
  const base64 = uint8ArrayToBase64(bytes);
  if (!base64) {
    return null;
  }
  return `data:${type || 'application/octet-stream'};base64,${base64}`;
}

