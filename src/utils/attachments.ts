import { Fyo } from 'fyo';
import { Attachment } from 'fyo/core/types';
import { getDataURL } from 'src/utils/misc';

const ATTACH_IMAGE_FILE_REF_PREFIX = 'books-file:';

/**
 * Returns a data URL suitable for download links and image previews.
 * Works for legacy DB-embedded attachments (`data`) and file-system (`path`) rows.
 */
export async function resolveAttachmentDataUrl(
  attachment: Attachment | null | undefined,
  fyo: Fyo
): Promise<string | null> {
  if (!attachment) {
    return null;
  }

  if (typeof attachment.data === 'string' && attachment.data.length > 0) {
    return attachment.data;
  }

  const dbPath = fyo.db?.dbPath;
  if (!attachment.path || !dbPath) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ipcApi = typeof ipc !== 'undefined' ? (ipc as any) : undefined;
  if (!ipcApi?.desktop || typeof ipcApi.attachments?.read !== 'function') {
    return null;
  }

  const res = (await ipcApi.attachments.read({
    dbPath,
    path: attachment.path,
  })) as { success?: boolean; data?: Uint8Array };

  if (!res?.success || !res.data) {
    return null;
  }

  const type = attachment.type || 'application/octet-stream';
  return getDataURL(type, Uint8Array.from(res.data));
}

export function attachmentLooksLikeImage(attachment: Attachment | null | undefined) {
  const t = attachment?.type ?? '';
  return typeof t === 'string' && t.startsWith('image/');
}

export function isAttachImageFileRef(value: string | null | undefined) {
  return (
    typeof value === 'string' &&
    value.length > ATTACH_IMAGE_FILE_REF_PREFIX.length &&
    value.startsWith(ATTACH_IMAGE_FILE_REF_PREFIX)
  );
}

export function getAttachImageFileRefPath(value: string) {
  return value.slice(ATTACH_IMAGE_FILE_REF_PREFIX.length);
}

export function makeAttachImageFileRef(path: string) {
  return `${ATTACH_IMAGE_FILE_REF_PREFIX}${path}`;
}

/**
 * Resolve AttachImage stored value to a data URL for <img :src="...">.
 *
 * AttachImage historically stored a data URL string in the DB.
 * When using file system storage, we store a lightweight reference string:
 * `books-file:<relative-path>`.
 */
export async function resolveAttachImageSrc(
  value: string | null | undefined,
  fyo: Fyo,
  typeHint?: string
): Promise<string | null> {
  if (!value) {
    return null;
  }

  // Legacy / default: already a data URL.
  if (!isAttachImageFileRef(value)) {
    return value;
  }

  const dbPath = fyo.db?.dbPath;
  if (!dbPath) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ipcApi = typeof ipc !== 'undefined' ? (ipc as any) : undefined;
  if (!ipcApi?.desktop || typeof ipcApi.attachments?.read !== 'function') {
    return null;
  }

  const res = (await ipcApi.attachments.read({
    dbPath,
    path: getAttachImageFileRefPath(value),
  })) as { success?: boolean; data?: Uint8Array };

  if (!res?.success || !res.data) {
    return null;
  }

  const type = typeHint || 'application/octet-stream';
  return getDataURL(type, Uint8Array.from(res.data));
}
