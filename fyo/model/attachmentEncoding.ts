function uint8ArrayToBase64(bytes: Uint8Array) {
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
  } catch {}

  // Fallback (Node-like)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any)?.Buffer;
  if (B) {
    return B.from(bytes).toString('base64');
  }
  return '';
}

export function dataUrlFromBytes(type: string, bytes: Uint8Array) {
  const base64 = uint8ArrayToBase64(bytes);
  return `data:${type || 'application/octet-stream'};base64,${base64}`;
}

