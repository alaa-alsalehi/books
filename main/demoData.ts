import fetch from 'node-fetch';
import type { DemoDatasetPayload, DemoItemSeed } from 'dummy/types';
import {
  getErrorMessageFromResponse,
  SUBSCRIPTION_SERVER,
} from './subscription';

export type DemoDatasetListRow = {
  name: string;
  key: string;
  title_en?: string;
  title_ar?: string;
  description_en?: string;
  description_ar?: string;
  locale?: string;
  industry?: string;
  country?: string;
  currency?: string;
  preview_images?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptionalStringField(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

/** Runtime check for API list_demo_datasets row shape. */
function isDemoDatasetListRow(value: unknown): value is DemoDatasetListRow {
  if (!isRecord(value)) {
    return false;
  }
  if (!isNonEmptyString(value.name)) {
    return false;
  }
  if (!isNonEmptyString(value.key)) {
    return false;
  }
  if (
    !isOptionalStringField(value.title_en) ||
    !isOptionalStringField(value.title_ar) ||
    !isOptionalStringField(value.description_en) ||
    !isOptionalStringField(value.description_ar) ||
    !isOptionalStringField(value.locale) ||
    !isOptionalStringField(value.industry) ||
    !isOptionalStringField(value.country) ||
    !isOptionalStringField(value.currency)
  ) {
    return false;
  }
  if (value.preview_images !== undefined) {
    if (!Array.isArray(value.preview_images)) {
      return false;
    }
    for (const url of value.preview_images) {
      if (typeof url !== 'string') {
        return false;
      }
    }
  }
  return true;
}

function validateDemoDatasetListRows(
  datasets: unknown[]
): DemoDatasetListRow[] | null {
  const out: DemoDatasetListRow[] = [];
  for (const item of datasets) {
    if (!isDemoDatasetListRow(item)) {
      return null;
    }
    out.push(item);
  }
  return out;
}

function getDemoItemSalesOrPurchasesScope(
  value: Record<string, unknown>
): string | null {
  if (
    typeof value.forSalesOrPurchases === 'string' &&
    value.forSalesOrPurchases.length > 0
  ) {
    return value.forSalesOrPurchases;
  }
  // API still sends JSON key "for" from Frappe (maps to Item.for on sync).
  if (typeof value.for === 'string' && value.for.length > 0) {
    return value.for;
  }
  return null;
}

function isDemoItemSeed(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (!isNonEmptyString(value.name)) {
    return false;
  }
  if (typeof value.unit !== 'string') {
    return false;
  }
  if (typeof value.itemType !== 'string') {
    return false;
  }
  if (typeof value.incomeAccount !== 'string') {
    return false;
  }
  if (typeof value.expenseAccount !== 'string') {
    return false;
  }
  if (typeof value.rate !== 'number' || Number.isNaN(value.rate)) {
    return false;
  }
  if (getDemoItemSalesOrPurchasesScope(value) === null) {
    return false;
  }
  if (
    value.tax !== undefined &&
    value.tax !== null &&
    typeof value.tax !== 'string'
  ) {
    return false;
  }
  return true;
}

function normalizeDemoItemSeed(raw: Record<string, unknown>): DemoItemSeed {
  const forSalesOrPurchases = getDemoItemSalesOrPurchasesScope(raw);
  if (forSalesOrPurchases === null) {
    throw new Error('normalizeDemoItemSeed: missing forSalesOrPurchases');
  }
  const rest = { ...raw };
  delete rest.for;
  delete rest.forSalesOrPurchases;
  return {
    ...(rest as Omit<DemoItemSeed, 'forSalesOrPurchases'>),
    forSalesOrPurchases,
  };
}

function normalizeDemoDatasetPayload(
  raw: Record<string, unknown>
): DemoDatasetPayload {
  const itemsRaw = raw.items;
  if (!Array.isArray(itemsRaw)) {
    throw new Error('normalizeDemoDatasetPayload: items must be an array');
  }
  const items = itemsRaw.map((it) => {
    if (!isRecord(it)) {
      throw new Error('normalizeDemoDatasetPayload: invalid item');
    }
    return normalizeDemoItemSeed(it);
  });
  return { ...(raw as DemoDatasetPayload), items };
}

function isDemoPartySeed(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (!isNonEmptyString(value.name)) {
    return false;
  }
  if (typeof value.role !== 'string') {
    return false;
  }
  if (typeof value.defaultAccount !== 'string') {
    return false;
  }
  if (typeof value.currency !== 'string') {
    return false;
  }
  return true;
}

function isPayloadOptions(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isNonEmptyString(value.companyName) &&
    isNonEmptyString(value.country) &&
    isNonEmptyString(value.currency) &&
    isNonEmptyString(value.chartOfAccounts) &&
    isNonEmptyString(value.fiscalYearStartMD) &&
    isNonEmptyString(value.fiscalYearEndMD)
  );
}

function isPartyPurchaseItemMap(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  for (const k of Object.keys(value)) {
    const row = value[k];
    if (!Array.isArray(row)) {
      return false;
    }
    for (const el of row) {
      if (typeof el !== 'string') {
        return false;
      }
    }
  }
  return true;
}

function isNumberArray(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  for (const x of value) {
    if (typeof x !== 'number' || Number.isNaN(x)) {
      return false;
    }
  }
  return true;
}

function isPeriodicPurchasesMap(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  for (const k of Object.keys(value)) {
    const n = value[k];
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return false;
    }
  }
  return true;
}

function isDemoDatasetPayloadMessage(
  value: unknown
): value is DemoDatasetPayload {
  if (!isRecord(value)) {
    return false;
  }
  if (!isNonEmptyString(value.key)) {
    return false;
  }
  if (!isPayloadOptions(value.options)) {
    return false;
  }
  if (!isRecord(value.address)) {
    return false;
  }
  if (!isRecord(value.accounting)) {
    return false;
  }
  if (!isRecord(value.printSettings)) {
    return false;
  }
  if (
    !Array.isArray(value.items) ||
    value.items.length === 0 ||
    !value.items.every(isDemoItemSeed)
  ) {
    return false;
  }
  if (
    !Array.isArray(value.parties) ||
    value.parties.length === 0 ||
    !value.parties.every(isDemoPartySeed)
  ) {
    return false;
  }
  if (!isPartyPurchaseItemMap(value.partyPurchaseItemMap)) {
    return false;
  }
  if (!isNumberArray(value.flow)) {
    return false;
  }
  if (
    value.periodicPurchases !== undefined &&
    !isPeriodicPurchasesMap(value.periodicPurchases)
  ) {
    return false;
  }
  return true;
}

export async function listDemoDatasets(token: string): Promise<{
  success: boolean;
  message: string;
  datasets: DemoDatasetListRow[];
}> {
  try {
    const res = await fetch(
      `${SUBSCRIPTION_SERVER}/api/method/rukn_books_subscription.api.list_demo_datasets`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
        },
      }
    );
    if (res.status === 200) {
      const body = (await res.json()) as { message?: unknown };
      const msg = body.message;
      if (isRecord(msg) && Array.isArray(msg.datasets)) {
        const datasets = validateDemoDatasetListRows(msg.datasets);
        if (datasets === null) {
          return {
            success: false,
            message: 'Invalid dataset item',
            datasets: [],
          };
        }
        return {
          success: true,
          message: 'OK',
          datasets,
        };
      }
      return {
        success: false,
        message: 'Unexpected response structure',
        datasets: [],
      };
    }
    return {
      success: false,
      message: await getErrorMessageFromResponse(res),
      datasets: [],
    };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return { success: false, message: m, datasets: [] };
  }
}

export async function getDemoDataset(
  token: string,
  key: string
): Promise<{
  success: boolean;
  message: string;
  payload?: DemoDatasetPayload;
}> {
  try {
    const res = await fetch(
      `${SUBSCRIPTION_SERVER}/api/method/rukn_books_subscription.api.get_demo_dataset?key=${encodeURIComponent(
        key
      )}`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${token}`,
        },
      }
    );
    if (res.status === 200) {
      const body = (await res.json()) as { message?: unknown };
      const msg = body.message;
      if (isDemoDatasetPayloadMessage(msg)) {
        return {
          success: true,
          message: 'OK',
          payload: normalizeDemoDatasetPayload(msg as Record<string, unknown>),
        };
      }
      return {
        success: false,
        message:
          'Invalid demo dataset response: missing or malformed payload fields',
      };
    }
    return {
      success: false,
      message: await getErrorMessageFromResponse(res),
    };
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    return { success: false, message: m };
  }
}
