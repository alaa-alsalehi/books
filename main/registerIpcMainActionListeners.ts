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
import { SelectFileOptions, SelectFileReturn } from 'utils/types';
import databaseManager from 'backend/database/manager';
import { emitMainProcessError } from 'backend/helpers';
import { Main } from 'main';
import { DatabaseMethod } from 'utils/db/types';
import { IPC_ACTIONS, IPC_CHANNELS } from 'utils/messages';
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
        const { dbPath, name, type, data } = params ?? {};
        if (!dbPath || typeof dbPath !== 'string') {
          return { success: false, message: 'Missing dbPath' };
        }
        if (!name || typeof name !== 'string') {
          return { success: false, message: 'Missing file name' };
        }
        if (!type || typeof type !== 'string') {
          return { success: false, message: 'Missing file type' };
        }

        let bytes: Uint8Array | null = null;
        if (data instanceof Uint8Array) {
          bytes = data;
        } else if (Buffer.isBuffer(data)) {
          bytes = new Uint8Array(data);
        } else if (data instanceof ArrayBuffer) {
          bytes = new Uint8Array(data);
        } else if (ArrayBuffer.isView(data)) {
          bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }

        if (!bytes) {
          return { success: false, message: 'Missing file data' };
        }

        const root = getAttachmentRootForDb(dbPath);
        await fs.ensureDir(root);

        const safeName = sanitizeFilename(name) || 'attachment';
        const stamp = new Date().toISOString().replace(/[-T:.Z]/g, '');
        const filename = `${stamp}_${safeName}`;
        const fullPath = path.join(root, filename);
        await fs.writeFile(fullPath, Buffer.from(bytes));

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
        return {
          success: true,
          name: path.basename(fullPath),
          type: undefined,
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
}
