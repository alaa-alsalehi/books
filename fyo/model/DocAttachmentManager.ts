import type { Field } from 'schemas/types';
import { FieldTypeEnum } from 'schemas/types';
import { toRaw } from 'vue';
import {
  decodeBooksStagedPath,
  encodeBooksStagedPath,
  isBooksStagedRef,
} from 'utils/attachmentStagingRef';
import { mimeTypeFromFilename } from 'utils/mimeType';
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

function isDocLike(v: unknown): v is DocLike {
  if (!v || typeof v !== 'object') return false;
  const anyV = v as any;
  return typeof anyV.get === 'function' && anyV.schema && anyV.schema.fields;
}

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

export class DocAttachmentManager {
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

  extractRefsForDelete(): { committed: string[]; stagedAbs: string[] } {
    const committed = Array.from(this.collectFilesystemRefs());
    const stagedAbs = this.#collectStagedAbsolutePaths(this.#doc);
    return { committed, stagedAbs };
  }

  async cleanupCapturedRefsAfterDelete(refs: {
    committed: string[];
    stagedAbs: string[];
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcApi = (globalThis as any)?.ipc;
    const dbPath = (this.#doc.fyo.db as any)?.dbPath as string | undefined;
    if (!this.#doc.fyo.isElectron || !dbPath) return;

    if (ipcApi?.desktop && typeof ipcApi.attachments?.delete === 'function') {
      await Promise.all(
        Array.from(new Set(refs.committed)).map(async (p) => {
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
        Array.from(new Set(refs.stagedAbs)).map(async (abs) => {
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
   * @returns Relative attachment paths created by this pass (for rollback if DB write fails).
   */
  async commitStagedBeforeDbWrite(): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcApi = (globalThis as any)?.ipc;
    const dbPath = (this.#doc.fyo.db as any)?.dbPath as string | undefined;
    if (
      !this.#doc.fyo.isElectron ||
      !dbPath ||
      !ipcApi?.desktop ||
      typeof ipcApi.attachments?.stageCommit !== 'function'
    ) {
      return [];
    }

    const { createdPaths, assignments } = await this.#commitStagedInDoc(
      this.#doc,
      ipcApi,
      dbPath
    );
    for (const apply of assignments) {
      apply();
    }
    return createdPaths;
  }

  /**
   * If DB insert/update fails after files were moved into `attachments/…`, delete those
   * new files and restore in-memory state (reload from DB for updates; clear fields for failed inserts).
   */
  async recoverAfterFailedDbWrite(
    committedRelativePaths: string[],
    opts: { failedDuringInsert: boolean }
  ) {
    this.#pendingDeletes.clear();
    const unique = [...new Set(committedRelativePaths.filter(Boolean))];
    if (unique.length > 0) {
      await this.#deleteCommittedPathsBestEffort(unique);
    }
    if (opts.failedDuringInsert) {
      if (unique.length > 0) {
        this.#clearAttachmentFieldsUsingPaths(new Set(unique));
      }
      this.snapshotAfterLoadOrSync();
    } else {
      const d = this.#doc as DocLike & { load?: () => Promise<void> };
      if (typeof d.load === 'function') {
        await d.load();
      }
    }
  }

  async #deleteCommittedPathsBestEffort(relativePaths: string[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcApi = (globalThis as any)?.ipc;
    const dbPath = (this.#doc.fyo.db as any)?.dbPath as string | undefined;
    if (!this.#doc.fyo.isElectron || !dbPath) return;
    if (!ipcApi?.desktop || typeof ipcApi.attachments?.delete !== 'function') {
      return;
    }
    await Promise.all(
      relativePaths.map(async (p) => {
        try {
          await ipcApi.attachments.delete({ dbPath, path: p });
        } catch {
          // best-effort
        }
      })
    );
  }

  #clearAttachmentFieldsUsingPaths(paths: Set<string>) {
    const clearIn = (d: DocLike) => {
      for (const field of d.schema.fields) {
        if (field.meta) continue;
        const fieldname = field.fieldname;
        const value = d.get(fieldname) as unknown;

        if (field.fieldtype === FieldTypeEnum.Attachment) {
          const p = getFilesystemPathFromAttachmentValue(value);
          if (p && paths.has(p)) {
            d[fieldname] = null;
          }
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
            const rel = v.slice(this.#attachImagePrefix.length);
            if (paths.has(rel)) {
              d[fieldname] = null;
            }
          }
          continue;
        }

        if (field.fieldtype === FieldTypeEnum.Table && Array.isArray(value)) {
          for (const row of value) {
            const child = toRaw(row) as DocLike;
            if (isDocLike(child)) {
              clearIn(child);
            }
          }
        }
      }
    };

    clearIn(toRaw(this.#doc) as DocLike);
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
  ): Promise<{ createdPaths: string[]; assignments: Array<() => void> }> {
    const createdPaths: string[] = [];
    const assignments: Array<() => void> = [];

    const rollbackAndThrow = async (context: {
      fieldname: string;
      stagePath: string;
      response: unknown;
    }) => {
      console.error('[books] stageCommit failed; rolling back committed files', {
        ...context,
        createdPaths,
      });

      if (ipcApi?.desktop && typeof ipcApi.attachments?.delete === 'function') {
        await Promise.all(
          createdPaths.map(async (p) => {
            try {
              await ipcApi.attachments.delete({ dbPath, path: p });
            } catch (err) {
              console.error('[books] rollback delete failed', { path: p, err });
            }
          })
        );
      } else {
        console.error(
          '[books] rollback unavailable (ipc.attachments.delete missing)'
        );
      }

      throw new Error(
        `[books] stageCommit failed for field '${context.fieldname}', aborting save`
      );
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
              assignments.push(() => {
                doc[fieldname] = {
                  ...v,
                  path: newPath,
                };
              });
              createdPaths.push(newPath);
            } else {
              await rollbackAndThrow({
                fieldname,
                stagePath: abs,
                response: res,
              });
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
              assignments.push(() => {
                doc[fieldname] = `${this.#attachImagePrefix}${newPath}`;
              });
              createdPaths.push(newPath);
            } else {
              await rollbackAndThrow({
                fieldname,
                stagePath: abs,
                response: res,
              });
            }
          }
        }
        continue;
      }

      if (field.fieldtype === FieldTypeEnum.Table && Array.isArray(value)) {
        for (const row of value) {
          const child = toRaw(row) as DocLike;
          if (isDocLike(child)) {
            const childRes = await this.#commitStagedInDoc(child, ipcApi, dbPath);
            createdPaths.push(...childRes.createdPaths);
            assignments.push(...childRes.assignments);
          }
        }
      }
    }
    return { createdPaths, assignments };
  }

  /**
   * Called from `Doc.duplicateForEdit()` after `duplicate()`. Replaces committed
   * filesystem attachment paths with staged copies so the unsaved duplicate does not
   * share files with the source (same stage → commit-on-sync lifecycle as a new upload).
   */
  async remapCommittedFilesystemAttachmentsToStagedAfterDuplicate() {
    if (getStorageMode(this.#doc) !== 'filesystem') {
      this.snapshotAfterLoadOrSync();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcApi = (globalThis as any)?.ipc;
    const dbPath = (this.#doc.fyo.db as any)?.dbPath as string | undefined;
    if (
      !this.#doc.fyo.isElectron ||
      !dbPath ||
      !ipcApi?.desktop ||
      typeof ipcApi.attachments?.read !== 'function' ||
      typeof ipcApi.attachments?.stageSave !== 'function'
    ) {
      this.snapshotAfterLoadOrSync();
      return;
    }

    await this.#remapDuplicateRefsInDoc(
      toRaw(this.#doc) as DocLike,
      ipcApi,
      dbPath
    );
    this.snapshotAfterLoadOrSync();
  }

  #normalizeAttachmentRow(value: unknown): {
    name?: string;
    type?: string;
    path?: string;
    data?: string;
  } | null {
    if (value == null) return null;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const v = value as {
        name?: string;
        type?: string;
        path?: string;
        data?: string;
      };
      return {
        name: v.name,
        type: v.type,
        path: v.path,
        data: v.data,
      };
    }
    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) return null;
      try {
        const parsed = JSON.parse(s) as {
          name?: string;
          type?: string;
          path?: string;
          data?: string;
        };
        if (parsed && typeof parsed === 'object') {
          return {
            name: parsed.name,
            type: parsed.type,
            path: parsed.path,
            data: parsed.data,
          };
        }
      } catch {
        return null;
      }
    }
    return null;
  }

  async #remapDuplicateRefsInDoc(
    doc: DocLike,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ipcApi: any,
    dbPath: string
  ) {
    const clearAndThrow = (
      fieldname: string,
      message: string,
      extra?: unknown
    ): never => {
      doc[fieldname] = null;
      console.error(`[books] duplicate attachment remap failed for '${fieldname}'`, extra);
      throw new Error(message);
    };

    for (const field of doc.schema.fields) {
      if (field.meta) continue;
      const fieldname = field.fieldname;
      const rawValue = doc.get(fieldname) as unknown;

      if (field.fieldtype === FieldTypeEnum.Attachment) {
        const v = this.#normalizeAttachmentRow(rawValue);
        if (!v) continue;
        const p = v.path;
        if (typeof p !== 'string' || !p || isBooksStagedRef(p)) continue;
        const readRes = (await ipcApi.attachments.read({
          dbPath,
          path: p,
        })) as {
          success?: boolean;
          data?: Uint8Array;
          name?: string;
          type?: string;
        };
        const data = readRes?.data;
        if (!readRes?.success || !(data instanceof Uint8Array) || data.length === 0) {
          clearAndThrow(
            fieldname,
            `[books] Failed to duplicate attachment '${fieldname}': could not read source file`,
            { sourcePath: p, response: readRes }
          );
        }
        const bytes = data as Uint8Array;
        const baseName =
          v.name ||
          readRes.name ||
          p.split(/[/\\]/).pop() ||
          'attachment';
        const mime = (readRes.type && readRes.type.length > 0
          ? readRes.type
          : typeof v.type === 'string' && v.type.length > 0
            ? v.type
            : mimeTypeFromFilename(baseName));
        const stagePath = await this.#ipcStageSave(
          ipcApi,
          dbPath,
          baseName,
          mime,
          bytes
        );
        if (stagePath == null) {
          clearAndThrow(
            fieldname,
            `[books] Failed to duplicate attachment '${fieldname}': could not stage copied bytes`,
            { sourcePath: p, name: baseName, type: mime }
          );
        }
        const stagePathStr = stagePath as string;
        doc[fieldname] = {
          name: baseName,
          type: mime,
          path: encodeBooksStagedPath(stagePathStr),
        };
        continue;
      }

      if (field.fieldtype === FieldTypeEnum.AttachImage) {
        if (typeof rawValue !== 'string') continue;
        const s = rawValue;
        if (!s || isBooksStagedRef(s)) continue;
        if (s.startsWith('data:')) continue;
        if (!s.startsWith(this.#attachImagePrefix)) continue;
        const relPath = s.slice(this.#attachImagePrefix.length);
        if (!relPath) continue;
        const readRes = (await ipcApi.attachments.read({
          dbPath,
          path: relPath,
        })) as {
          success?: boolean;
          data?: Uint8Array;
          name?: string;
          type?: string;
        };
        const data = readRes?.data;
        if (!readRes?.success || !(data instanceof Uint8Array) || data.length === 0) {
          clearAndThrow(
            fieldname,
            `[books] Failed to duplicate AttachImage '${fieldname}': could not read source file`,
            { sourcePath: relPath, response: readRes }
          );
        }
        const bytes = data as Uint8Array;
        const baseName = readRes.name || relPath.split(/[/\\]/).pop() || 'image';
        const mime =
          (readRes.type && readRes.type.length > 0
            ? readRes.type
            : mimeTypeFromFilename(baseName));
        const stagePath = await this.#ipcStageSave(
          ipcApi,
          dbPath,
          baseName,
          mime,
          bytes
        );
        if (stagePath == null) {
          clearAndThrow(
            fieldname,
            `[books] Failed to duplicate AttachImage '${fieldname}': could not stage copied bytes`,
            { sourcePath: relPath, name: baseName, type: mime }
          );
        }
        doc[fieldname] = encodeBooksStagedPath(stagePath as string);
        continue;
      }

      if (field.fieldtype === FieldTypeEnum.Table && Array.isArray(rawValue)) {
        for (const row of rawValue) {
          const child = toRaw(row) as DocLike;
          if (isDocLike(child)) {
            await this.#remapDuplicateRefsInDoc(child, ipcApi, dbPath);
          }
        }
      }
    }
  }

  #collectStagedAbsolutePaths(d: DocLike): string[] {
    const out: string[] = [];

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

        const dataUrl = dataUrlFromBytes(v.type, v.bytes);
        if (!dataUrl) {
          return value;
        }
        return { name: v.name, type: v.type, data: dataUrl };
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

      return dataUrlFromBytes(v.type, v.data) ?? null;
    }

    return value;
  }

  collectFilesystemRefs(): Set<string> {
    const refs = new Set<string>();

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
