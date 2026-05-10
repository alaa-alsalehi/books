import { DateTime } from 'luxon';

const DEFAULT_FLOW_VALUES = [
  0.35, 0.25, 0.15, 0.15, 0.25, 0.05, 0.05, 0.15, 0.25, 0.35, 0.45, 0.55,
];

// prettier-ignore
export const partyPurchaseItemMap: Record<string, string[]> = {
  'Janky Office Spaces': ['Office Rent', 'Office Cleaning'],
  "Josféña's 611s": ['611 Jeans - PCH', '611 Jeans - SHR'],
  'Lankness Feet Fomenters': ['Bominga Shoes', 'Jade Slippers'],
  'The Overclothes Company': ['Jacket - RAW', 'Cryo Gloves', 'Cool Cloth'],
  'Adani Electricity Mumbai Limited': ['Electricity'],
  'Only Fulls': ['Full Sleeve - BLK', 'Full Sleeve - COL'],
  'Just Epaulettes': ['Epaulettes - 4POR'],
  'Le Socials': ['Social Ads'],
  'Maxwell': ['Marketing - Video'],
};

export const purchaseItemPartyMap: Record<string, string> = Object.keys(
  partyPurchaseItemMap
).reduce((acc, party) => {
  for (const item of partyPurchaseItemMap[party]) {
    acc[item] = party;
  }
  return acc;
}, {} as Record<string, string>);

/** @deprecated use getFlowArray() for dynamic demo payloads */
export const flow = DEFAULT_FLOW_VALUES;

let activeFlow: number[] = [...DEFAULT_FLOW_VALUES];

let activePurchaseItemPartyMap: Record<string, string> = {
  ...purchaseItemPartyMap,
};

function buildReversePurchaseMap(
  map: Record<string, string[]>
): Record<string, string> {
  const acc: Record<string, string> = {};
  for (const party of Object.keys(map)) {
    for (const item of map[party]) {
      acc[item] = party;
    }
  }
  return acc;
}

export function resetDummyHelpers(): void {
  activeFlow = [...DEFAULT_FLOW_VALUES];
  activePurchaseItemPartyMap = { ...purchaseItemPartyMap };
}

export function applyDummyHelpersOverrides(
  flowOverride?: number[] | null,
  partyPurchaseItemMapOverride?: Record<string, string[]> | null
): void {
  resetDummyHelpers();
  if (flowOverride && flowOverride.length === 12) {
    activeFlow = [...flowOverride];
  }
  if (
    partyPurchaseItemMapOverride &&
    Object.keys(partyPurchaseItemMapOverride).length
  ) {
    activePurchaseItemPartyMap = buildReversePurchaseMap(
      partyPurchaseItemMapOverride
    );
  }
}

export function getFlowArray(): number[] {
  return activeFlow;
}

export function getPurchaseItemPartyMap(): Record<string, string> {
  return activePurchaseItemPartyMap;
}

export function getFlowConstant(months: number) {
  const d = DateTime.now().minus({ months });
  return activeFlow[d.month - 1];
}

export function getRandomDates(count: number, months: number): Date[] {
  /**
   * Returns `count` number of dates for a month, `months` back from the
   * current date.
   */
  let endDate = DateTime.now();
  if (months !== 0) {
    const back = endDate.minus({ months });
    endDate = DateTime.local(back.year, back.month, back.daysInMonth);
  }

  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    const day = Math.ceil(endDate.day * Math.random());
    const date = DateTime.local(endDate.year, endDate.month, day);
    dates.push(date.toJSDate());
  }

  return dates;
}
