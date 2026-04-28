import type { Doc } from 'fyo/model/doc';
import type { Money } from 'pesa';
import type { RawValue } from 'schemas/types';
import type { AuthDemuxBase } from 'utils/auth/types';
import type { DatabaseDemuxBase } from 'utils/db/types';

export type Attachment = {
  name: string;
  type: string;
  /**
   * Legacy inline attachment data (data URL).
   * Kept for backwards compatibility with existing databases.
   */
  data?: string;
  /**
   * Path to attachment on disk.
   * Prefer storing this over `data` so attachments are not embedded in the DB.
   *
   * Can be relative to the database directory.
   */
  path?: string;
  /**
   * Non-serialized bytes used during upload/update.
   * The converter may persist these bytes either into `data` (DB)
   * or into a file and set `path` (filesystem).
   */
  bytes?: Uint8Array;
};
export type DocValue =
  | string
  | number
  | boolean
  | Date
  | Money
  | null
  | Attachment
  | undefined;
export type DocValueMap = Record<string, DocValue | Doc[] | DocValueMap[]>;
export type RawValueMap = Record<string, RawValue | RawValueMap[]>;

/**
 * DatabaseDemuxConstructor: type for a constructor that returns a DatabaseDemuxBase
 * it's typed this way because `typeof AbstractClass` is invalid as abstract classes
 * can't be initialized using `new`.
 *
 * AuthDemuxConstructor: same as the above but for AuthDemuxBase
 */

export type DatabaseDemuxConstructor = new (
  isElectron?: boolean
) => DatabaseDemuxBase;

export type AuthDemuxConstructor = new (isElectron?: boolean) => AuthDemuxBase;

export type ConfigMap = {
  files: ConfigFile[];
  lastSelectedFilePath: null | string;
  language: string;
  deviceId: string;
  /** ERPNext import settings used before a DB exists (welcome screen). */
  erpnextImportBaseURL?: string;
  /** ERPNext API token in the form api_key:api_secret. */
  erpnextImportAuthToken?: string;
  /** Encrypted subscription token (base64 of safeStorage cipher). */
  subscriptionToken?: string;
  /** Subscription settings docname returned by the server. */
  subscriptionDocname?: string;
  /** Subscription settings doctype returned by the server. */
  subscriptionDoctype?: string;
  /**
   * Subscription feature flags returned by the server.
   * Keys are Books feature names, values indicate enablement.
   */
  subscriptionFeatures?: Record<string, boolean>;
  /** Unique instance ID for this installation (for Books Instance doctype). */
  subscriptionInstanceId?: string;
  /** Unix timestamp (ms) of last successful subscription verification. */
  subscriptionLastVerifiedAt?: number;
};

export interface ConfigFile {
  id: string;
  companyName: string;
  dbPath: string;
  openCount: number;
}

export interface FyoConfig {
  DatabaseDemux?: DatabaseDemuxConstructor;
  AuthDemux?: AuthDemuxConstructor;
  isElectron?: boolean;
  isTest?: boolean;
}
