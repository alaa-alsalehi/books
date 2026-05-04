import type { Field } from 'schemas/types';
import { FieldTypeEnum } from 'schemas/types';
import { toRaw } from 'vue';
import {
  decodeBooksStagedPath,
  encodeBooksStagedPath,
  isBooksStagedRef,
} from 'utils/attachmentStagingRef';
import { dataUrlFromBytes } from './attachmentEncoding';

type AttachmentStorageMode = 'database' | 'filesystem';

type DocLike = {
  schema: {
    fields: Array<{ fieldname: string; fieldtype: string; meta?: boolean }>;
  };
  fyo: {
    isElectron: boolean;
    singles: { SystemSettings?: unknown };
    db: unknown;
  };
  get(fieldname: string): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

function getStorageMode(doc: DocLike): AttachmentStorageMode {
  return (
    ((doc.fyo.singles.SystemSettings as any)?.attachmentStorage as
      | AttachmentStorageMode
      | undefined) ?? 'database'
  );
}

/**
 * After `load()`, Attachment columns are often still JSON strings (see
 * `_setValuesWithoutChecks(..., false)`). After `set()` they are `{ path }` objects.
 */
function getFilesystemPathFromAttachmentValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const path = (value as { path?: string }).path;
    if (typeof path === 'string' && isBooksStagedRef(path)) {
      return null;
    }
    return typeof path === 'string' && path.length > 0 ? path : null;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) {
      return null;
    }
    if (isBooksStagedRef(s)) {
      return null;
    }
    try {
      const parsed = JSON.parse(s) as { path?: string };
      const path = parsed?.path;
      if (typeof path === 'string' && isBooksStagedRef(path)) {
        return null;
      }
      return typeof path === 'string' && path.length > 0 ? path : null;
    } catch {
      return null;
    }
  }
  return null;
}

export class AttachmentManager {
  readonly #doc: DocLike;
  readonly #attachImagePrefix: string;

  // Snapshot at last successful load/sync (committed paths only).
  #fsSnapshot: Set<string> = new Set();
  // Paths to delete after a successful sync.
  #pendingDeletes: Set<string> = new Set();

  constructor(doc: DocLike, attachImagePrefix: string) {
    this.#doc = doc;
    this.#attachImagePrefix = attachImagePrefix;
  }

  snapshotAfterLoadOrSync() {
    this.#fsSnapshot = this.collectFilesystemRefs();
  }

  prepareRemovedOnPreSync() {
    const current = this.collectFilesystemRefs();
    const removed = new Set<string>(this.#pendingDeletes);
    for (const oldRef of this.#fsSnapshot) {
      if (!current.has(oldRef)) {
        removed.add(oldRef);
      }
    }
    this.#pendingDeletes = removed;
  }

  async flushPendingDeletesAfterSync() {
    if (!this.#pendingDeletes.size) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcApi = (globalThis as any)?.ipc;
    const dbPath = (this.#doc.fyo.db as any)?.dbPath as string | undefined;
    if (!this.#doc.fyo.isElectron || !dbPath) {
      this.#pendingDeletes.clear();
      return;
    }
    if (!ipcApi?.desktop || typeof ipcApi.attachments?.delete !== 'function') {
      this.#pendingDeletes.clear();
      return;
    }

    const paths = Array.from(this.#pendingDeletes);
    this.#pendingDeletes.clear();
    await Promise.all(
      paths.map(async (p) => {
        try {
          await ipcApi.attachments.delete({ dbPath, path: p });
        } catch {
          // best-effort
        }
      })
    );
  }

  async cleanupBeforeDelete() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcApi = (globalThis as any)?.ipc;
    const dbPath = (this.#doc.fyo.db as any)?.dbPath as string | undefined;
    if (!this.#doc.fyo.isElectron || !dbPath) return;

    const committed = this.collectFilesystemRefs();
    const stagedAbs = this.#collectStagedAbsolutePaths(this.#doc);

    if (ipcApi?.desktop && typeof ipcApi.attachments?.delete === 'function') {
      await Promise.all(
        Array.from(committed).map(async (p) => {
          try {
            await ipcApi.attachments.delete({ dbPath, path: p });
          } catch {
            // best-effort
          }
        })
      );
    }

    if (
      ipcApi?.desktop &&
      typeof ipcApi.attachments?.stageDelete === 'function'
    ) {
      await Promise.all(
        stagedAbs.map(async (abs) => {
          try {
            await ipcApi.attachments.stageDelete({ stagePath: abs });
          } catch {
            // best-effort
          }
        })
      );
    }
  }

  /**
   * Before DB insert/update: move staged temp files into final attachments folder
   * and replace `books-staged:` tokens with committed paths.
   */
  async commitStagedBeforeDbWrite() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcApi = (globalThis as any)?.ipc;
    const dbPath = (this.#doc.fyo.db as any)?.dbPath as string | undefined;
    if (
      !this.#doc.fyo.isElectron ||
      !dbPath ||
      !ipcApi?.desktop ||
      typeof ipcApi.attachments?.stageCommit !== 'function'
    ) {
      return;
    }

    await this.#commitStagedInDoc(this.#doc, ipcApi, dbPath);
  }

  /**
   * On reload/discard without syncing: remove staged temp files.
   */
  async discardStagedOnReload() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcApi = (globalThis as any)?.ipc;
    if (
      !ipcApi?.desktop ||
      typeof ipcApi.attachments?.stageDelete !== 'function'
    ) {
      return;
    }

    const absPaths = this.#collectStagedAbsolutePaths(this.#doc);
    const seen = new Set<string>();
    for (const abs of absPaths) {
      if (seen.has(abs)) continue;
      seen.add(abs);
      try {
        await ipcApi.attachments.stageDelete({ stagePath: abs });
      } catch {
        // best-effort
      }
    }
  }

  async #commitStagedInDoc(
    doc: DocLike,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcApi: any,
    dbPath: string
  ) {
    const isDocLike = (v: unknown): v is DocLike => {
      if (!v || typeof v !== 'object') return false;
      const anyV = v as any;
      return typeof anyV.get === 'function' && anyV.schema && anyV.schema.fields;
    };

    for (const field of doc.schema.fields) {
      if (field.meta) continue;
      const fieldname = field.fieldname;
      const value = doc.get(fieldname) as unknown;

      if (field.fieldtype === FieldTypeEnum.Attachment) {
        const v = value as { path?: string; name?: string; type?: string } | null;
        const p = v?.path;
        if (typeof p === 'string' && isBooksStagedRef(p)) {
          const abs = decodeBooksStagedPath(p);
          if (abs) {
            const res = (await ipcApi.attachments.stageCommit({
              dbPath,
              stagePath: abs,
            })) as {
              success?: boolean;
              attachment?: { path?: string; name?: string };
            };
            const newPath = res?.success ? res?.attachment?.path : undefined;
            if (newPath) {
              doc[fieldname] = {
                ...v,
                path: newPath,
              };
            }
          }
        }
        continue;
      }

      if (field.fieldtype === FieldTypeEnum.AttachImage) {
        if (typeof value === 'string' && isBooksStagedRef(value)) {
          const abs = decodeBooksStagedPath(value);
          if (abs) {
            const res = (await ipcApi.attachments.stageCommit({
              dbPath,
              stagePath: abs,
            })) as {
              success?: boolean;
              attachment?: { path?: string };
            };
            const newPath = res?.success ? res?.attachment?.path : undefined;
            if (newPath) {
              doc[fieldname] = `${this.#attachImagePrefix}${newPath}`;
            }
          }
        }
        continue;
      }

      if (field.fieldtype === FieldTypeEnum.Table && Array.isArray(value)) {
        for (const row of value) {
          const child = toRaw(row) as DocLike;
          if (isDocLike(child)) {
            await this.#commitStagedInDoc(child, ipcApi, dbPath);
          }
        }
      }
    }
  }

  #collectStagedAbsolutePaths(d: DocLike): string[] {
    const out: string[] = [];
    const isDocLike = (v: unknown): v is DocLike => {
      if (!v || typeof v !== 'object') return false;
      const anyV = v as any;
      return typeof anyV.get === 'function' && anyV.schema && anyV.schema.fields;
    };

    const scan = (doc: DocLike) => {
      for (const field of doc.schema.fields) {
        if (field.meta) continue;
        const value = doc.get(field.fieldname) as unknown;

        if (field.fieldtype === FieldTypeEnum.Attachment) {
          const v = value as { path?: string } | null;
          const p = v?.path;
          if (typeof p === 'string' && isBooksStagedRef(p)) {
            const abs = decodeBooksStagedPath(p);
            if (abs) out.push(abs);
          }
          continue;
        }

        if (field.fieldtype === FieldTypeEnum.AttachImage) {
          if (typeof value === 'string' && isBooksStagedRef(value)) {
            const abs = decodeBooksStagedPath(value);
            if (abs) out.push(abs);
          }
          continue;
        }

        if (field.fieldtype === FieldTypeEnum.Table && Array.isArray(value)) {
          for (const row of value) {
            const child = toRaw(row) as DocLike;
            if (isDocLike(child)) scan(child);
          }
        }
      }
    };

    scan(toRaw(d) as DocLike);
    return out;
  }

  async #deleteStagedPathIfAny(pathOrRef: string | null) {
    if (!pathOrRef || !isBooksStagedRef(pathOrRef)) return;
    const abs = decodeBooksStagedPath(pathOrRef);
    if (!abs) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcApi = (globalThis as any)?.ipc;
    if (!ipcApi?.desktop || typeof ipcApi.attachments?.stageDelete !== 'function') {
      return;
    }
    try {
      await ipcApi.attachments.stageDelete({ stagePath: abs });
    } catch {
      // best-effort
    }
  }

  async #reconcilePreviousAttachmentPath(prevPath: string | null) {
    if (!prevPath) return;
    if (isBooksStagedRef(prevPath)) {
      await this.#deleteStagedPathIfAny(prevPath);
    } else {
      this.#pendingDeletes.add(prevPath);
    }
  }

  async #reconcilePreviousAttachImage(prevStr: string | null) {
    if (!prevStr) return;
    if (isBooksStagedRef(prevStr)) {
      await this.#deleteStagedPathIfAny(prevStr);
    } else if (prevStr.startsWith(this.#attachImagePrefix)) {
      this.#pendingDeletes.add(prevStr.slice(this.#attachImagePrefix.length));
    }
  }

  #readStagePathFromResponse(res: {
    success?: boolean;
    stagePath?: string;
    attachment?: { stagePath?: string };
  }): string | null {
    if (!res?.success) return null;
    const s = res.stagePath ?? res.attachment?.stagePath;
    return typeof s === 'string' && s.length > 0 ? s : null;
  }

  async #ipcStageSave(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcApi: any,
    dbPath: string,
    name: string,
    type: string,
    data: Uint8Array
  ): Promise<string | null> {
    const res = (await ipcApi.attachments.stageSave({
      dbPath,
      name,
      type,
      data,
    })) as {
      success?: boolean;
      stagePath?: string;
      attachment?: { stagePath?: string };
    };
    return this.#readStagePathFromResponse(res);
  }

  async #ipcFinalSave(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcApi: any,
    dbPath: string,
    name: string,
    type: string,
    data: Uint8Array
  ): Promise<string | null> {
    const res = (await ipcApi.attachments.save({
      dbPath,
      name,
      type,
      data,
    })) as { success?: boolean; attachment?: { path?: string } };
    return res?.success && res.attachment?.path ? res.attachment.path : null;
  }

  async normalizeBeforeSet(field: Field, value: unknown): Promise<unknown> {
    const storage = getStorageMode(this.#doc);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcApi = (globalThis as any)?.ipc;
    const dbPath = (this.#doc.fyo.db as any)?.dbPath as string | undefined;
    const canUseFs =
      storage === 'filesystem' &&
      this.#doc.fyo.isElectron &&
      !!dbPath &&
      ipcApi?.desktop &&
      typeof ipcApi.attachments?.save === 'function' &&
      typeof ipcApi.attachments?.delete === 'function';

    const canStage =
      canUseFs &&
      typeof ipcApi.attachments?.stageSave === 'function' &&
      typeof ipcApi.attachments?.stageCommit === 'function' &&
      typeof ipcApi.attachments?.stageDelete === 'function';

    if (field.fieldtype === FieldTypeEnum.Attachment) {
      const v = value as
        | null
        | undefined
        | {
            name?: string;
            type?: string;
            data?: string;
            path?: string;
            bytes?: Uint8Array;
          };
      if (!v) return value;

      const prev = this.#doc.get(field.fieldname) as any;
      const prevPath =
        typeof prev?.path === 'string' ? prev.path : null;

      if (v.bytes instanceof Uint8Array && v.name && v.type) {
        if (canStage) {
          const stagePath = await this.#ipcStageSave(
            ipcApi,
            dbPath!,
            v.name,
            v.type,
            v.bytes
          );
          if (stagePath) {
            await this.#reconcilePreviousAttachmentPath(prevPath);
            return {
              name: v.name,
              type: v.type,
              path: encodeBooksStagedPath(stagePath),
            };
          }
        }

        if (canUseFs) {
          const newPath = await this.#ipcFinalSave(
            ipcApi,
            dbPath!,
            v.name,
            v.type,
            v.bytes
          );
          if (newPath) {
            await this.#reconcilePreviousAttachmentPath(prevPath);
            return { name: v.name, type: v.type, path: newPath };
          }
        }

        return { name: v.name, type: v.type, data: dataUrlFromBytes(v.type, v.bytes) };
      }

      return value;
    }

    if (field.fieldtype === FieldTypeEnum.AttachImage) {
      if (typeof value === 'string' || value === null) {
        return value;
      }

      const v = value as { name?: string; type?: string; data?: Uint8Array };
      if (!(v?.data instanceof Uint8Array) || !v.type) {
        return value;
      }

      const prev = this.#doc.get(field.fieldname) as any;
      const prevStr = typeof prev === 'string' ? prev : null;
      const imageName = v.name || 'image';

      if (canStage) {
        const stagePath = await this.#ipcStageSave(
          ipcApi,
          dbPath!,
          imageName,
          v.type,
          v.data
        );
        if (stagePath) {
          await this.#reconcilePreviousAttachImage(prevStr);
          return encodeBooksStagedPath(stagePath);
        }
      }

      if (canUseFs) {
        const newPath = await this.#ipcFinalSave(
          ipcApi,
          dbPath!,
          imageName,
          v.type,
          v.data
        );
        if (newPath) {
          await this.#reconcilePreviousAttachImage(prevStr);
          return `${this.#attachImagePrefix}${newPath}`;
        }
      }

      return dataUrlFromBytes(v.type, v.data);
    }

    return value;
  }

  collectFilesystemRefs(): Set<string> {
    const refs = new Set<string>();

    const isDocLike = (v: unknown): v is DocLike => {
      if (!v || typeof v !== 'object') return false;
      const anyV = v as any;
      return typeof anyV.get === 'function' && anyV.schema && anyV.schema.fields;
    };

    const scan = (d: DocLike) => {
      for (const field of d.schema.fields) {
        if (field.meta) continue;
        const value = d.get(field.fieldname) as unknown;

        if (field.fieldtype === FieldTypeEnum.Attachment) {
          const p = getFilesystemPathFromAttachmentValue(value);
          if (p) refs.add(p);
          continue;
        }

        if (field.fieldtype === FieldTypeEnum.AttachImage) {
          const v = value as string | null | undefined;
          if (
            typeof v === 'string' &&
            !isBooksStagedRef(v) &&
            v.startsWith(this.#attachImagePrefix) &&
            v.length > this.#attachImagePrefix.length
          ) {
            refs.add(v.slice(this.#attachImagePrefix.length));
          }
          continue;
        }

        if (field.fieldtype === FieldTypeEnum.Table && Array.isArray(value)) {
          for (const row of value) {
            const child = toRaw(row) as DocLike;
            if (isDocLike(child)) {
              scan(child);
            }
          }
        }
      }
    };

    scan(toRaw(this.#doc) as DocLike);
    return refs;
  }
}
