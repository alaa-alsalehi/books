import fetch from 'node-fetch';
import type { DemoDatasetPayload } from 'dummy/types';
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
        return {
          success: true,
          message: 'OK',
          datasets: msg.datasets as DemoDatasetListRow[],
        };
      }
      return { success: true, message: 'OK', datasets: [] };
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
      return {
        success: true,
        message: 'OK',
        payload: body.message as DemoDatasetPayload,
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
