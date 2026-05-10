import { safeStorage } from 'electron';
import config from 'utils/config';
import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import { randomBytes } from 'crypto';
import { SUBSCRIPTION_FEATURE_SERVER_MAP } from 'utils/subscriptionFeatures';

export const SUBSCRIPTION_SERVER =
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:8001'
    : 'https://books.rukn.sh';
export const GRACE_PERIOD_DAYS = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function getErrorMessageFromResponse(
  res: Response
): Promise<string> {
  try {
    const raw = await res.text();
    const t = raw.trim();

    let obj: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = JSON.parse(raw);
      obj = isRecord(parsed) ? parsed : null;
    } catch {
      // ignore
    }

    // Common Frappe/ERPNext error shapes:
    // - { exception: "...", exc: "...", _error_message: "..." }
    // - { message: "..." } or { message: { ... } }
    // - { _server_messages: '["..."]' }
    const errMsg = obj?._error_message;
    if (typeof errMsg === 'string' && errMsg) {
      return errMsg;
    }

    const msg = obj?.message;
    if (typeof msg === 'string' && msg) {
      return msg;
    }

    const exc = obj?.exception;
    if (typeof exc === 'string' && exc) {
      return exc;
    }

    const rawServerMessages = obj?._server_messages;
    if (typeof rawServerMessages === 'string' && rawServerMessages) {
      try {
        const msgs = JSON.parse(rawServerMessages) as unknown;
        if (Array.isArray(msgs) && typeof msgs[0] === 'string' && msgs[0]) {
          return msgs[0];
        }
      } catch {
        // ignore
      }
    }

    if (t) {
      return t.slice(0, 200);
    }
  } catch {
    // ignore
  }

  return `Server returned ${res.status}`;
}

/**
 * Call the Rukn server to verify the API token.
 * Token format: "api_key:api_secret"
 */
async function verifyTokenWithServer(token: string): Promise<{
  valid: boolean;
  email: string;
  message: string;
  features?: Record<string, boolean>;
}> {
  try {
    const instanceId = getInstanceId();
    const res = await fetch(
      `${SUBSCRIPTION_SERVER}/api/method/rukn_books_subscription.api.validate_api_token?instance_id=${encodeURIComponent(
        instanceId
      )}`,
      {
        // Use POST since the server updates `last_seen` and may be rolled back on GET.
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
        },
      }
    );
    if (res.status === 200) {
      const body = (await res.json()) as { message: unknown };
      let email = '';
      let features: Record<string, boolean> | undefined;
      if (body.message && typeof body.message === 'object') {
        const msgData = body.message as Record<string, unknown>;
        const docname = typeof msgData.name === 'string' ? msgData.name : '';
        email = docname;
        if (docname) config.set('subscriptionDocname', docname);

        const doctype =
          typeof msgData.doctype === 'string' ? msgData.doctype : '';
        if (doctype) config.set('subscriptionDoctype', doctype);

        // Optional feature-flags payload from subscription settings.
        // Server uses snake_case keys; Books uses camelCase fieldnames.
        const bool = (v: unknown): boolean | undefined => {
          if (typeof v === 'boolean') return v;
          if (v === 0 || v === 1) return Boolean(v);
          if (typeof v === 'string') {
            const t = v.trim().toLowerCase();
            if (t === '1' || t === 'true' || t === 'yes') return true;
            if (t === '0' || t === 'false' || t === 'no') return false;
          }
          return undefined;
        };

        for (const [serverKey, booksKey] of Object.entries(
          SUBSCRIPTION_FEATURE_SERVER_MAP
        )) {
          const v = bool(msgData[serverKey]);
          if (v === undefined) continue;
          features ??= {};
          features[booksKey] = v;
        }
      } else if (typeof body.message === 'string') {
        email = body.message;
      }
      if (features) {
        config.set('subscriptionFeatures', features);
      }
      return { valid: true, email, message: 'OK', features };
    }

    const serverMsg = await getErrorMessageFromResponse(res);
    return {
      valid: false,
      email: '',
      message: serverMsg || 'Invalid or expired token',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, email: '', message: `Connection error: ${msg}` };
  }
}

export default verifyTokenWithServer;

/**
 * Encrypt the token using Electron's safeStorage (OS keychain-backed AES)
 * and store the ciphertext as base64 in electron-store config.
 */
export function storeToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback: store plaintext (only for debugging / unsupported OS)
    config.set('subscriptionToken', token);
    return;
  }

  const encrypted = safeStorage.encryptString(token);
  config.set('subscriptionToken', encrypted.toString('base64'));
}

/** Decrypt and return the stored token; returns null if none. */
export function retrieveToken(): string | null {
  const stored = config.get('subscriptionToken');
  if (!stored) return null;

  if (!safeStorage.isEncryptionAvailable()) {
    return stored; // stored as plaintext fallback
  }

  try {
    const buf = Buffer.from(stored, 'base64');
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

/** Remove the stored token. */
export function clearToken(): void {
  config.delete('subscriptionToken');
  config.delete('subscriptionLastVerifiedAt');
}

/** Get or generate a stable unique instance ID for "Books Instance" doctype. */
export function getInstanceId(): string {
  let id = config.get('subscriptionInstanceId');
  if (id) return id;

  // Generate a short random ID like "abc123-def4567890" (16 hex chars split 6-10)
  id = randomBytes(8)
    .toString('hex')
    .replace(/(.{6})/, '$1-');
  config.set('subscriptionInstanceId', id);
  return id;
}

/** Record the current time as last successful verification. */
export function setLastVerifiedAt(): void {
  config.set('subscriptionLastVerifiedAt', Date.now());
}

/** Return the timestamp of the last successful verification, or null. */
export function getLastVerifiedAt(): number | null {
  const ts = config.get('subscriptionLastVerifiedAt');
  return ts ?? null;
}

/** Check whether we are within the offline grace period. */
export function isWithinGracePeriod(): boolean {
  const last = getLastVerifiedAt();
  if (last === null) return false;

  const elapsed = Date.now() - last;
  return elapsed < GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Upload the database file to the Rukn server.
 * Uses the /api/method/upload_file endpoint.
 * Builds multipart/form-data manually to avoid extra dependencies.
 */
let isSyncing = false;

export async function syncDatabaseToServer(
  dbPath: string,
  token: string
): Promise<{ success: boolean; message: string }> {
  if (isSyncing) {
    return { success: false, message: 'Sync already in progress' };
  }

  isSyncing = true;
  try {
    const fs = await import('fs-extra');
    const path = await import('path');

    if (!dbPath || !(await fs.pathExists(dbPath))) {
      return { success: false, message: 'No database file found' };
    }

    let fileToSync = dbPath;
    const backupFolder = path.join(path.dirname(dbPath), 'backups');

    if (await fs.pathExists(backupFolder)) {
      let baseName = path.parse(dbPath).name;
      if (baseName.endsWith('.books')) {
        baseName = baseName.slice(0, -6);
      }

      const files = await fs.readdir(backupFolder);
      let latestBackup = '';
      let latestTime = 0;

      for (const file of files) {
        if (file.startsWith(baseName + '_') && file.endsWith('.books.db')) {
          const filePath = path.join(backupFolder, file);
          const stats = await fs.stat(filePath);
          if (stats.mtimeMs > latestTime) {
            latestTime = stats.mtimeMs;
            latestBackup = filePath;
          }
        }
      }

      if (latestBackup) {
        fileToSync = latestBackup;
        console.log(`[Sync] Found latest backup to sync: ${fileToSync}`);
      }
    }

    const fileName = path.basename(fileToSync);
    const fileBuffer = await fs.readFile(fileToSync);

    // Build multipart/form-data manually
    const boundary = `----BooksSync${Date.now()}${randomBytes(4).toString(
      'hex'
    )}`;
    const CRLF = '\r\n';

    const textFields: Record<string, string> = {
      is_private: '1',
      folder: 'Home/Attachments',
      doctype:
        config.get('subscriptionDoctype') || 'Books Subscription Settings',
      docname: config.get('subscriptionDocname') || '',
    };

    const parts: Buffer[] = [];

    // Text fields
    for (const [key, value] of Object.entries(textFields)) {
      parts.push(
        Buffer.from(
          `--${boundary}${CRLF}` +
            `Content-Disposition: form-data; name="${key}"${CRLF}${CRLF}` +
            `${value}${CRLF}`
        )
      );
    }

    // File field
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}` +
          `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
          `Content-Type: application/octet-stream${CRLF}${CRLF}`
      )
    );
    parts.push(fileBuffer);
    parts.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));

    const body = Buffer.concat(parts as unknown as Uint8Array[]);

    try {
      const res = await fetch(`${SUBSCRIPTION_SERVER}/api/method/upload_file`, {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (res.status === 200) {
        return { success: true, message: 'Database synced successfully' };
      }

      const errBody = await res.text();
      return {
        success: false,
        message: `Server returned ${res.status}: ${errBody.slice(0, 200)}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Sync failed: ${msg}` };
    }
  } finally {
    isSyncing = false;
  }
}

export async function reportIssueToServer(
  token: string,
  payload: {
    title: string;
    description: string;
    instance_id?: string;
    instance_name?: string;
    app_version?: string;
    platform?: string;
    logs?: string;
  }
): Promise<{ success: boolean; message: string; name?: string }> {
  try {
    const res = await fetch(
      `${SUBSCRIPTION_SERVER}/api/method/rukn_books_subscription.api.report_issue`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    if (res.status === 200) {
      const body = (await res.json()) as { message?: unknown };
      const msg = body?.message;
      if (msg && typeof msg === 'object') {
        const m = msg as Record<string, unknown>;
        const name = typeof m.name === 'string' ? m.name : undefined;
        return { success: true, message: 'OK', name };
      }
      return { success: true, message: 'OK' };
    }

    const serverMsg = await getErrorMessageFromResponse(res);
    return { success: false, message: serverMsg || `Server returned ${res.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Connection error: ${msg}` };
  }
}
