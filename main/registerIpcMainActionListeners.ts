import {
  MessageBoxOptions,
  OpenDialogOptions,
  SaveDialogOptions,
  app,
  dialog,
  ipcMain,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { constants } from 'fs';
import fs from 'fs-extra';
import path from 'path';
import { tmpdir } from 'os';
import { SelectFileOptions, SelectFileReturn } from 'utils/types';
import databaseManager from 'backend/database/manager';
import { emitMainProcessError } from 'backend/helpers';
import { Main } from 'main';
import { DatabaseMethod } from 'utils/db/types';
import { IPC_ACTIONS, IPC_CHANNELS } from 'utils/messages';
import { mimeTypeFromFilename } from 'utils/mimeType';
import { getUrlAndTokenString, sendError } from './contactMothership';
import { getLanguageMap } from './getLanguageMap';
import { getTemplates } from './getPrintTemplates';
import { printHtmlDocument } from './printHtmlDocument';
import {
  getConfigFilesWithModified,
  getErrorHandledReponse,
  isNetworkError,
  setAndGetCleanedConfigFiles,
} from './helpers';
import { saveHtmlAsPdf } from './saveHtmlAsPdf';
import { sendAPIRequest } from './api';
import { initScheduler } from './initSheduler';
import config from 'utils/config';
import verifyTokenWithServer, {
  storeToken,
  retrieveToken,
  clearToken,
  setLastVerifiedAt,
  isWithinGracePeriod,
  syncDatabaseToServer,
  reportIssueToServer,
} from './subscription';
import { getDemoDataset, listDemoDatasets } from './demoData';

function sanitizeFilename(name: string) {
  return name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-') // reserved on Windows + path separators
    .replace(/\s+/g, ' ')
    .slice(0, 180);
}

function getAttachmentRootForDb(dbPath: string) {
  const dir = path.dirname(dbPath);
  const dbBase = path.basename(dbPath, '.books.db');
  return path.join(dir, 'attachments', dbBase || 'default');
}

function getAttachmentStageRootForDb(dbPath: string) {
  const dbBase = path.basename(dbPath, '.books.db');
  return path.join(tmpdir(), 'rukn-books', 'attachments-stage', dbBase || 'default');
}

function isPathInsideStageRoot(stagePath: string): boolean {
  const resolved = path.resolve(stagePath);
  const prefix = path.join(tmpdir(), 'rukn-books', 'attachments-stage');
  const normalizedPrefix = path.resolve(prefix);
  return resolved.startsWith(normalizedPrefix + path.sep);
}

type ParsedAttachmentParams =
  | { ok: true; dbPath: string; name: string; type: string; bytes: Uint8Array }
  | { ok: false; message: string };

function normalizeIncomingAttachmentBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

function parseAttachmentParams(
  params:
    | { dbPath: string; name: string; type: string; data: unknown }
    | null
    | undefined
): ParsedAttachmentParams {
  const { dbPath, name, type, data } = params ?? {};
  if (!dbPath || typeof dbPath !== 'string') {
    return { ok: false, message: 'Missing dbPath' };
  }
  if (!name || typeof name !== 'string') {
    return { ok: false, message: 'Missing file name' };
  }
  if (!type || typeof type !== 'string') {
    return { ok: false, message: 'Missing file type' };
  }
  const bytes = normalizeIncomingAttachmentBytes(data);
  if (!bytes) {
    return { ok: false, message: 'Missing file data' };
  }
  return { ok: true, dbPath, name, type, bytes };
}

async function writeStampedAttachmentFile(
  rootDir: string,
  originalName: string,
  bytes: Uint8Array
): Promise<{ fullPath: string; safeName: string }> {
  await fs.ensureDir(rootDir);
  const safeName = sanitizeFilename(originalName) || 'attachment';
  const stamp = new Date().toISOString().replace(/[-T:.Z]/g, '');
  const filename = `${stamp}_${safeName}`;
  const fullPath = path.join(rootDir, filename);
  await fs.writeFile(fullPath, Buffer.from(bytes));
  return { fullPath, safeName };
}

export default function registerIpcMainActionListeners(main: Main) {
  ipcMain.handle(IPC_ACTIONS.CHECK_DB_ACCESS, async (_, filePath: string) => {
    try {
      await fs.access(filePath, constants.W_OK | constants.R_OK);
    } catch (err) {
      return false;
    }

    return true;
  });

  ipcMain.handle(
    IPC_ACTIONS.GET_DB_DEFAULT_PATH,
    async (_, companyName: string) => {
      let root: string;
      try {
        root = app.getPath('documents');
      } catch {
        root = app.getPath('userData');
      }

      if (main.isDevelopment) {
        root = 'dbs';
      }

      const dbsPath = path.join(root, 'Rukn Books');
      const backupPath = path.join(dbsPath, 'backups');
      await fs.ensureDir(backupPath);

      let dbFilePath = path.join(dbsPath, `${companyName}.books.db`);

      if (await fs.pathExists(dbFilePath)) {
        const option = await dialog.showMessageBox({
          type: 'question',
          title: 'File Exists',
          message: `Filename already exists. Do you want to overwrite the existing file or create a new one?`,
          buttons: ['Overwrite', 'New'],
        });

        if (option.response === 1) {
          const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '');

          dbFilePath = path.join(
            dbsPath,
            `${companyName}_${timestamp}.books.db`
          );

          await dialog.showMessageBox({
            type: 'info',
            message: `New file: ${path.basename(dbFilePath)}`,
          });
        }
      }

      return dbFilePath;
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.GET_OPEN_FILEPATH,
    async (_, options: OpenDialogOptions) => {
      return await dialog.showOpenDialog(main.mainWindow!, options);
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.GET_SAVE_FILEPATH,
    async (_, options: SaveDialogOptions) => {
      return await dialog.showSaveDialog(main.mainWindow!, options);
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.GET_DIALOG_RESPONSE,
    async (_, options: MessageBoxOptions) => {
      if (main.isDevelopment || main.isLinux) {
        Object.assign(options, { icon: main.icon });
      }

      return await dialog.showMessageBox(main.mainWindow!, options);
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.SHOW_ERROR,
    (_, { title, content }: { title: string; content: string }) => {
      return dialog.showErrorBox(title, content);
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.SAVE_HTML_AS_PDF,
    async (
      _,
      html: string,
      savePath: string,
      width: number,
      height: number
    ) => {
      return await saveHtmlAsPdf(html, savePath, app, width, height);
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.PRINT_HTML_DOCUMENT,
    async (_, html: string, width: number, height: number) => {
      return await printHtmlDocument(html, app, width, height);
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.SAVE_DATA,
    async (_, data: string, savePath: string) => {
      return await fs.writeFile(savePath, data, { encoding: 'utf-8' });
    }
  );

  ipcMain.handle(IPC_ACTIONS.SEND_ERROR, async (_, bodyJson: string) => {
    await sendError(bodyJson, main);
  });

  ipcMain.handle(IPC_ACTIONS.CHECK_FOR_UPDATES, async () => {
    if (main.isDevelopment || main.checkedForUpdate) {
      return;
    }

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      if (isNetworkError(error as Error)) {
        return;
      }

      emitMainProcessError(error);
    }
    main.checkedForUpdate = true;
  });

  ipcMain.handle(IPC_ACTIONS.GET_LANGUAGE_MAP, async (_, code: string) => {
    const obj = { languageMap: {}, success: true, message: '' };
    try {
      obj.languageMap = await getLanguageMap(code);
    } catch (err) {
      obj.success = false;
      obj.message = (err as Error).message;
    }

    return obj;
  });

  ipcMain.handle(
    IPC_ACTIONS.SELECT_FILE,
    async (_, options: SelectFileOptions): Promise<SelectFileReturn> => {
      const response: SelectFileReturn = {
        name: '',
        filePath: '',
        success: false,
        data: Buffer.from('', 'utf-8'),
        canceled: false,
      };
      const { filePaths, canceled } = await dialog.showOpenDialog(
        main.mainWindow!,
        { ...options, properties: ['openFile'] }
      );

      response.filePath = filePaths?.[0];
      response.canceled = canceled;

      if (!response.filePath) {
        return response;
      }

      response.success = true;
      if (canceled) {
        return response;
      }

      response.name = path.basename(response.filePath);
      response.data = await fs.readFile(response.filePath);
      return response;
    }
  );

  ipcMain.handle(IPC_ACTIONS.GET_CREDS, () => {
    return getUrlAndTokenString();
  });

  ipcMain.handle(IPC_ACTIONS.DELETE_FILE, async (_, filePath: string) => {
    return getErrorHandledReponse(async () => await fs.unlink(filePath));
  });

  ipcMain.handle(IPC_ACTIONS.GET_DB_LIST, async () => {
    const files = await setAndGetCleanedConfigFiles();
    return await getConfigFilesWithModified(files);
  });

  ipcMain.handle(IPC_ACTIONS.GET_ENV, async () => {
    let version = app.getVersion();
    if (main.isDevelopment) {
      const packageJson = await fs.readFile('package.json', 'utf-8');
      version = (JSON.parse(packageJson) as { version: string }).version;
    }

    return {
      isDevelopment: main.isDevelopment,
      platform: process.platform,
      version,
    };
  });

  ipcMain.handle(
    IPC_ACTIONS.GET_TEMPLATES,
    async (_, posPrintWidth?: number) => {
      return getTemplates(posPrintWidth);
    }
  );

  ipcMain.handle(IPC_ACTIONS.INIT_SHEDULER, async (_, interval: string) => {
    return initScheduler(interval);
  });

  ipcMain.handle(
    IPC_ACTIONS.SEND_API_REQUEST,
    async (_, endpoint: string, options: any) => {
      return sendAPIRequest(endpoint, options);
    }
  );

  /**
   * Subscription Related Actions
   */

  ipcMain.handle(IPC_ACTIONS.VERIFY_SUBSCRIPTION, async (_, token: string) => {
    const result = await verifyTokenWithServer(token);
    if (result.valid) {
      storeToken(token);
      setLastVerifiedAt();
      main.mainWindow?.webContents.send(
        IPC_CHANNELS.NEED_SUBSCRIPTION,
        false
      );
    } else {
      clearToken();
      main.mainWindow?.webContents.send(
        IPC_CHANNELS.NEED_SUBSCRIPTION,
        true
      );
    }
    return result;
  });

  ipcMain.handle(IPC_ACTIONS.GET_STORED_TOKEN, async () => {
    const token = retrieveToken();
    if (!token) {
      return { valid: false, email: '', withinGrace: false };
    }

    const withinGrace = isWithinGracePeriod();

    const verifyPromise = verifyTokenWithServer(token)
      .then((result) => {
        if (result.valid) {
          setLastVerifiedAt();
          main.mainWindow?.webContents.send(
            IPC_CHANNELS.NEED_SUBSCRIPTION,
            false
          );
        } else {
          clearToken();
          main.mainWindow?.webContents.send(
            IPC_CHANNELS.NEED_SUBSCRIPTION,
            true
          );
        }
        return result;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[Subscription] Token verification failed', err);
        emitMainProcessError(err);
        return null;
      });

    if (withinGrace) {
      return { valid: false, email: '', withinGrace: true };
    }

    // Not within grace: try a very short verification window so we can sometimes
    // return `valid: true` without noticeably delaying startup.
    const timeoutMs = 10000;
    const timedResult = await Promise.race([
      verifyPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);

    if (timedResult?.valid) {
      return { valid: true, email: timedResult.email, withinGrace: false };
    }

    // If we timed out or verification failed/invalid, return fast.
    // `verifyPromise` may still complete later and update lastVerifiedAt on success.
    return { valid: false, email: '', withinGrace: false };
  });

  ipcMain.handle(IPC_ACTIONS.CLEAR_SUB_TOKEN, () => {
    clearToken();
  });

  ipcMain.handle(IPC_ACTIONS.SYNC_DB_NOW, async () => {
    const token = retrieveToken();
    const backupPath = await databaseManager.createBackup();
    if (!token || !backupPath) {
      return { success: false, message: 'No token or database path available' };
    }
    return await syncDatabaseToServer(backupPath, token);
  });

  ipcMain.handle(
    IPC_ACTIONS.REPORT_ISSUE,
    async (
      _,
      payload: {
        title: string;
        description: string;
        instance_id?: string;
        instance_name?: string;
        app_version?: string;
        platform?: string;
        logs?: string;
      }
    ) => {
      const token = retrieveToken();
      if (!token) {
        return { success: false, message: 'No subscription token available' };
      }
      return await reportIssueToServer(token, payload);
    }
  );

  ipcMain.handle(IPC_ACTIONS.LIST_DEMO_DATASETS, async () => {
    const token = retrieveToken();
    if (!token) {
      return {
        success: false,
        message: 'No subscription token',
        datasets: [],
      };
    }
    try {
      return await listDemoDatasets(token);
    } catch (error) {
      return {
        success: false,
        message: (error as Error).message || 'Failed to list demo datasets',
        datasets: [],
      };
    }
  });

  ipcMain.handle(IPC_ACTIONS.GET_DEMO_DATASET, async (_, key: string) => {
    const token = retrieveToken();
    if (!token) {
      return { success: false, message: 'No subscription token' };
    }
    try {
      return await getDemoDataset(token, key);
    } catch (error) {
      return {
        success: false,
        message: (error as Error).message || 'Failed to get demo dataset',
      };
    }
  });

  /**
   * Database Related Actions
   */

  ipcMain.handle(
    IPC_ACTIONS.DB_CREATE,
    async (_, dbPath: string, countryCode: string) => {
      return await getErrorHandledReponse(async () => {
        return await databaseManager.createNewDatabase(dbPath, countryCode);
      });
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.DB_CONNECT,
    async (_, dbPath: string, countryCode?: string) => {
      return await getErrorHandledReponse(async () => {
        return await databaseManager.connectToDatabase(dbPath, countryCode);
      });
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.DB_CALL,
    async (_, method: DatabaseMethod, ...args: unknown[]) => {
      return await getErrorHandledReponse(async () => {
        return await databaseManager.call(method, ...args);
      });
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.DB_BESPOKE,
    async (_, method: string, ...args: unknown[]) => {
      return await getErrorHandledReponse(async () => {
        return await databaseManager.callBespoke(method, ...args);
      });
    }
  );

  ipcMain.handle(IPC_ACTIONS.DB_SCHEMA, async () => {
    return await getErrorHandledReponse(() => {
      return databaseManager.getSchemaMap();
    });
  });

  /**
   * Attachment actions: store attachments as separate files on disk.
   * We keep only a relative path reference in the DB, so DB stays small.
   */
  ipcMain.handle(
    IPC_ACTIONS.ATTACHMENT_SAVE,
    async (
      _,
      params: { dbPath: string; name: string; type: string; data: unknown }
    ) => {
      return await getErrorHandledReponse(async () => {
        const parsed = parseAttachmentParams(params);
        if (!parsed.ok) {
          return { success: false, message: parsed.message };
        }
        const { dbPath, name, type, bytes } = parsed;

        const root = getAttachmentRootForDb(dbPath);
        const { fullPath, safeName } = await writeStampedAttachmentFile(
          root,
          name,
          bytes
        );

        const relativePath = path.relative(path.dirname(dbPath), fullPath);
        return {
          success: true,
          attachment: { name: safeName, type, path: relativePath },
        };
      });
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.ATTACHMENT_READ,
    async (_, params: { dbPath: string; path: string }) => {
      return await getErrorHandledReponse(async () => {
        const { dbPath, path: relOrAbs } = params ?? {};
        if (!dbPath || typeof dbPath !== 'string') {
          return { success: false, message: 'Missing dbPath' };
        }
        if (!relOrAbs || typeof relOrAbs !== 'string') {
          return { success: false, message: 'Missing attachment path' };
        }

        const fullPath = path.isAbsolute(relOrAbs)
          ? relOrAbs
          : path.join(path.dirname(dbPath), relOrAbs);
        const buf = await fs.readFile(fullPath);
        const name = path.basename(fullPath);
        return {
          success: true,
          name,
          type: mimeTypeFromFilename(name),
          data: new Uint8Array(buf),
        };
      });
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.ATTACHMENT_DELETE,
    async (_, params: { dbPath: string; path: string }) => {
      return await getErrorHandledReponse(async () => {
        const { dbPath, path: relOrAbs } = params ?? {};
        if (!dbPath || typeof dbPath !== 'string') {
          return { success: false, message: 'Missing dbPath' };
        }
        if (!relOrAbs || typeof relOrAbs !== 'string') {
          return { success: false, message: 'Missing attachment path' };
        }

        const fullPath = path.isAbsolute(relOrAbs)
          ? relOrAbs
          : path.join(path.dirname(dbPath), relOrAbs);
        await fs.remove(fullPath);
        return { success: true };
      });
    }
  );

  /**
   * Staging: write bytes to OS temp until document sync commits to attachments folder.
   */
  ipcMain.handle(
    IPC_ACTIONS.ATTACHMENT_STAGE_SAVE,
    async (
      _,
      params: { dbPath: string; name: string; type: string; data: unknown }
    ) => {
      return await getErrorHandledReponse(async () => {
        const parsed = parseAttachmentParams(params);
        if (!parsed.ok) {
          return { success: false, message: parsed.message };
        }
        const { dbPath, name, type, bytes } = parsed;

        const stageRoot = getAttachmentStageRootForDb(dbPath);
        const { fullPath, safeName } = await writeStampedAttachmentFile(
          stageRoot,
          name,
          bytes
        );

        return {
          success: true,
          stagePath: fullPath,
          attachment: {
            name: safeName,
            type,
            stagePath: fullPath,
          },
        };
      });
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.ATTACHMENT_STAGE_COMMIT,
    async (_, params: { dbPath: string; stagePath: string }) => {
      return await getErrorHandledReponse(async () => {
        const { dbPath, stagePath } = params ?? {};
        if (!dbPath || typeof dbPath !== 'string') {
          return { success: false, message: 'Missing dbPath' };
        }
        if (!stagePath || typeof stagePath !== 'string') {
          return { success: false, message: 'Missing stage path' };
        }
        if (!isPathInsideStageRoot(stagePath)) {
          return { success: false, message: 'Invalid stage path' };
        }
        if (!(await fs.pathExists(stagePath))) {
          return { success: false, message: 'Staged file not found' };
        }

        const finalRoot = getAttachmentRootForDb(dbPath);
        await fs.ensureDir(finalRoot);

        const baseName = path.basename(stagePath);
        const dest = path.join(finalRoot, baseName);
        await fs.move(stagePath, dest, { overwrite: true });

        const relativePath = path.relative(path.dirname(dbPath), dest);
        return {
          success: true,
          attachment: {
            name: baseName,
            path: relativePath,
          },
        };
      });
    }
  );

  ipcMain.handle(
    IPC_ACTIONS.ATTACHMENT_STAGE_DELETE,
    async (_, params: { stagePath: string }) => {
      return await getErrorHandledReponse(async () => {
        const { stagePath } = params ?? {};
        if (!stagePath || typeof stagePath !== 'string') {
          return { success: false, message: 'Missing stage path' };
        }
        if (!isPathInsideStageRoot(stagePath)) {
          return { success: false, message: 'Invalid stage path' };
        }
        await fs.remove(stagePath);
        return { success: true };
      });
    }
  );
}
