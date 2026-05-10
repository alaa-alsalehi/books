import { Fyo, t } from 'fyo';
import { Doc } from 'fyo/model/doc';
import { range, sample } from 'lodash';
import { DateTime } from 'luxon';
import { Invoice } from 'models/baseModels/Invoice/Invoice';
import { Payment } from 'models/baseModels/Payment/Payment';
import { PurchaseInvoice } from 'models/baseModels/PurchaseInvoice/PurchaseInvoice';
import { SalesInvoice } from 'models/baseModels/SalesInvoice/SalesInvoice';
import { ModelNameEnum } from 'models/types';
import setupInstance from 'src/setup/setupInstance';
import { getMapFromList, safeParseInt } from 'utils';
import { getFiscalYear } from 'utils/misc';
import {
  getFlowConstantWithFlow,
  getRandomDates,
  resetDummyHelpers,
  resolveDummyFlow,
  resolvePurchaseItemPartyLookup,
} from './helpers';
import itemsCatalogDefault from './items.json';
import logo from './logo';
import partiesCatalogDefault from './parties.json';
import type { DemoDatasetPayload, DemoItemSeed } from './types';

export type { DemoDatasetPayload } from './types';

type Notifier = (stage: string, percent: number) => void;

type CatalogItem = DemoItemSeed;
type CatalogParty = typeof partiesCatalogDefault[number];

const DEFAULT_PERIODIC_PURCHASES: Record<string, number> = {
  'Marketing - Video': 2,
  'Social Ads': 1,
  Electricity: 1,
  'Office Cleaning': 1,
  'Office Rent': 1,
};

/** Per-run dummy generator state (safe for concurrent setupDummyInstance calls). */
type DummyRunContext = {
  payload: DemoDatasetPayload | null;
  catalogItems: CatalogItem[];
  catalogParties: CatalogParty[];
  flow: number[];
  purchaseItemPartyMap: Record<string, string>;
};

function createDummyRunContext(
  payload?: DemoDatasetPayload | null
): DummyRunContext {
  const catalogItems =
    (payload?.items as CatalogItem[]) ?? (itemsCatalogDefault as CatalogItem[]);
  const catalogParties =
    (payload?.parties as CatalogParty[]) ?? partiesCatalogDefault;
  return {
    payload: payload ?? null,
    catalogItems,
    catalogParties,
    flow: resolveDummyFlow(payload?.flow ?? null),
    purchaseItemPartyMap: resolvePurchaseItemPartyLookup(
      payload?.partyPurchaseItemMap ?? null
    ),
  };
}

async function defaultReceivableAccount(fyo: Fyo): Promise<string> {
  if (await fyo.db.exists(ModelNameEnum.Account, 'Debtors')) {
    return 'Debtors';
  }
  if (await fyo.db.exists(ModelNameEnum.Account, 'Trade Receivable')) {
    return 'Trade Receivable';
  }
  const rows = (await fyo.db.getAll(ModelNameEnum.Account, {
    fields: ['name'],
    filters: { accountType: 'Receivable', isGroup: false },
    limit: 1,
  })) as { name: string }[];
  return rows[0]?.name ?? 'Debtors';
}

async function defaultPayableAccount(fyo: Fyo): Promise<string> {
  if (await fyo.db.exists(ModelNameEnum.Account, 'Creditors')) {
    return 'Creditors';
  }
  if (await fyo.db.exists(ModelNameEnum.Account, 'Trade Payable')) {
    return 'Trade Payable';
  }
  const rows = (await fyo.db.getAll(ModelNameEnum.Account, {
    fields: ['name'],
    filters: { accountType: 'Payable', isGroup: false },
    limit: 1,
  })) as { name: string }[];
  return rows[0]?.name ?? 'Creditors';
}

async function defaultCashAccount(fyo: Fyo): Promise<string> {
  if (await fyo.db.exists(ModelNameEnum.Account, 'Cash')) {
    return 'Cash';
  }
  const rows = (await fyo.db.getAll(ModelNameEnum.Account, {
    fields: ['name'],
    filters: { accountType: 'Cash', isGroup: false },
    limit: 1,
  })) as { name: string }[];
  return rows[0]?.name ?? 'Cash';
}

async function ensureUnitedArabEmiratesDemoTaxes(fyo: Fyo) {
  const specs = [
    { name: 'VAT-5', rate: 5 },
    { name: 'VAT-0', rate: 0 },
  ];
  for (const spec of specs) {
    if (await fyo.db.exists(ModelNameEnum.Tax, spec.name)) {
      continue;
    }
    const doc = fyo.doc.getNewDoc(
      ModelNameEnum.Tax,
      {
        name: spec.name,
        details: [{ account: 'Sales Tax Payable', rate: spec.rate }],
      },
      false
    );
    await doc.sync();
  }
}

export async function setupDummyInstance(
  dbPath: string,
  fyo: Fyo,
  years = 1,
  baseCount = 1000,
  notifier?: Notifier,
  payload?: DemoDatasetPayload | null
) {
  const ctx = createDummyRunContext(payload ?? null);

  await fyo.purgeCache();
  notifier?.(fyo.t`Setting Up Instance`, -1);

  const fyStart = payload?.options.fiscalYearStartMD ?? '04-01';
  const fyEnd = payload?.options.fiscalYearEndMD ?? '04-01';

  const options = payload
    ? (() => {
        const fyStartDate = getFiscalYear(fyStart, true);
        const fyEndDate = getFiscalYear(fyEnd, false);
        if (!fyStartDate || !fyEndDate) {
          throw new Error(
            `Invalid fiscal year format: start=${fyStart}, end=${fyEnd}`
          );
        }
        return {
          logo: null as string | null,
          companyName: payload.options.companyName,
          country: payload.options.country,
          fullname: payload.options.fullname ?? '',
          email: payload.options.email ?? '',
          bankName: payload.options.bankName ?? '',
          currency: payload.options.currency,
          fiscalYearStart: fyStartDate.toISOString(),
          fiscalYearEnd: fyEndDate.toISOString(),
          chartOfAccounts: payload.options.chartOfAccounts,
        };
      })()
    : {
        logo: null as string | null,
        companyName: "Flo's Clothes",
        country: 'India',
        fullname: 'Lin Florentine',
        email: 'lin@flosclothes.com',
        bankName: 'Supreme Bank',
        currency: 'INR',
        fiscalYearStart: getFiscalYear('04-01', true)!.toISOString(),
        fiscalYearEnd: getFiscalYear('04-01', false)!.toISOString(),
        chartOfAccounts: 'India - Chart of Accounts',
      };

  let prevSkipTelemetryLogging = false;
  let skipTelemetryLoggingWasOverridden = false;
  try {
    await setupInstance(dbPath, options, fyo);
    if (payload?.options.country === 'United Arab Emirates') {
      await ensureUnitedArabEmiratesDemoTaxes(fyo);
    }
    prevSkipTelemetryLogging = fyo.store?.skipTelemetryLogging ?? false;
    fyo.store.skipTelemetryLogging = true;
    skipTelemetryLoggingWasOverridden = true;

    years = Math.floor(years);
    notifier?.(fyo.t`Creating Items and Parties`, -1);
    await generateStaticEntries(fyo, ctx);
    await generateDynamicEntries(fyo, years, baseCount, notifier, ctx);
    await setOtherSettings(fyo, payload ?? undefined);

    const instanceId = (await fyo.getValue(
      ModelNameEnum.SystemSettings,
      'instanceId'
    )) as string;
    await fyo.singles.SystemSettings?.setAndSync('hideGetStarted', true);

    return { companyName: options.companyName, instanceId };
  } finally {
    if (skipTelemetryLoggingWasOverridden) {
      fyo.store.skipTelemetryLogging = prevSkipTelemetryLogging;
    }
    resetDummyHelpers();
  }
}

async function setOtherSettings(fyo: Fyo, payload?: DemoDatasetPayload) {
  const doc = await fyo.doc.getDoc(ModelNameEnum.PrintSettings);
  const address = fyo.doc.getNewDoc(ModelNameEnum.Address);

  if (payload?.address) {
    const emirateOrState = payload.address.state || payload.address.city || '';
    await address.setAndSync({
      addressLine1: payload.address.addressLine1 ?? '',
      city: payload.address.city ?? '',
      state: payload.address.state ?? '',
      pos: emirateOrState,
      postalCode: payload.address.postalCode ?? '',
      country: payload.address.country ?? payload.options.country,
    });

    const ps = payload.printSettings;
    const displayLogo =
      typeof ps.displayLogo === 'boolean'
        ? ps.displayLogo
        : Boolean(ps.displayLogo);
    await doc.setAndSync({
      color: ps.color ?? '#F687B3',
      template: 'Business',
      displayLogo,
      phone: payload.accounting.phone ?? '',
      logo,
      address: address.name,
    });

    const acc = await fyo.doc.getDoc(ModelNameEnum.AccountingSettings);
    const patch: Record<string, string> = {};
    if (payload.options.country === 'India' && payload.accounting.taxId) {
      patch.gstin = payload.accounting.taxId;
    }
    if (Object.keys(patch).length) {
      await acc.setAndSync(patch);
    }
    return;
  }

  await address.setAndSync({
    addressLine1: '1st Column, Fitzgerald Bridge',
    city: 'Pune',
    state: 'Maharashtra',
    pos: 'Maharashtra',
    postalCode: '411001',
    country: 'India',
  });

  await doc.setAndSync({
    color: '#F687B3',
    template: 'Business',
    displayLogo: true,
    phone: '+91 8983-000418',
    logo,
    address: address.name,
  });

  const acc = await fyo.doc.getDoc(ModelNameEnum.AccountingSettings);
  await acc.setAndSync({
    gstin: '27LIN180000A1Z5',
  });
}

/**
 *  warning: long functions ahead!
 */

async function generateDynamicEntries(
  fyo: Fyo,
  years: number,
  baseCount: number,
  notifier: Notifier | undefined,
  ctx: DummyRunContext
) {
  const salesInvoices = await getSalesInvoices(
    fyo,
    years,
    baseCount,
    notifier,
    ctx
  );

  notifier?.(fyo.t`Creating Purchase Invoices`, -1);
  const purchaseInvoices = await getPurchaseInvoices(
    fyo,
    years,
    salesInvoices,
    ctx
  );

  notifier?.(fyo.t`Creating Journal Entries`, -1);
  const journalEntries = await getJournalEntries(fyo, salesInvoices, ctx);
  await syncAndSubmit(journalEntries, notifier);

  const invoices = ([salesInvoices, purchaseInvoices].flat() as Invoice[]).sort(
    (a, b) => +(a.date as Date) - +(b.date as Date)
  );
  await syncAndSubmit(invoices, notifier);

  const payments = await getPayments(fyo, invoices);
  await syncAndSubmit(payments, notifier);
}

async function getJournalEntries(
  fyo: Fyo,
  salesInvoices: SalesInvoice[],
  ctx: DummyRunContext
) {
  if (ctx.payload?.options.country === 'United Arab Emirates') {
    return [];
  }
  const entries = [];
  const amount = salesInvoices
    .map((i) => i.items!)
    .flat()
    .reduce((a, b) => a.add(b.amount!), fyo.pesa(0))
    .percent(75)
    .clip(0);
  const lastInv = salesInvoices.sort((a, b) => +a.date! - +b.date!).at(-1)!
    .date!;
  const date = DateTime.fromJSDate(lastInv).minus({ months: 6 }).toJSDate();

  // Bank Entry
  let doc = fyo.doc.getNewDoc(
    ModelNameEnum.JournalEntry,
    {
      date,
      entryType: 'Bank Entry',
    },
    false
  );
  await doc.append('accounts', {
    account: 'Supreme Bank',
    debit: amount,
    credit: fyo.pesa(0),
  });

  await doc.append('accounts', {
    account: 'Secured Loans',
    credit: amount,
    debit: fyo.pesa(0),
  });
  entries.push(doc);

  // Cash Entry
  doc = fyo.doc.getNewDoc(
    ModelNameEnum.JournalEntry,
    {
      date,
      entryType: 'Cash Entry',
    },
    false
  );
  await doc.append('accounts', {
    account: 'Cash',
    debit: amount.percent(30),
    credit: fyo.pesa(0),
  });

  await doc.append('accounts', {
    account: 'Supreme Bank',
    credit: amount.percent(30),
    debit: fyo.pesa(0),
  });
  entries.push(doc);

  return entries;
}

async function getPayments(fyo: Fyo, invoices: Invoice[]) {
  const recvAccount = await defaultReceivableAccount(fyo);
  const payAccount = await defaultPayableAccount(fyo);
  const cashAccount = await defaultCashAccount(fyo);
  const payments = [];
  for (const invoice of invoices) {
    // Defaulters
    if (invoice.isSales && Math.random() < 0.007) {
      continue;
    }

    const doc = fyo.doc.getNewDoc(ModelNameEnum.Payment, {}, false) as Payment;
    doc.party = invoice.party as string;
    doc.paymentType = invoice.isSales ? 'Receive' : 'Pay';
    doc.paymentMethod = 'Cash';
    doc.date = DateTime.fromJSDate(invoice.date as Date)
      .plus({ hours: 1 })
      .toJSDate();
    if (doc.paymentType === 'Receive') {
      doc.account = recvAccount;
      doc.paymentAccount = cashAccount;
    } else {
      doc.account = cashAccount;
      doc.paymentAccount = payAccount;
    }
    doc.amount = invoice.outstandingAmount;

    // Discount
    if (invoice.isSales && Math.random() < 0.05) {
      await doc.set('writeOff', invoice.outstandingAmount?.percent(15));
    }

    doc.push('for', {
      referenceType: invoice.schemaName,
      referenceName: invoice.name,
      amount: invoice.outstandingAmount,
    });

    if (doc.amount!.isZero()) {
      continue;
    }

    payments.push(doc);
  }

  return payments;
}

function getSalesInvoiceDates(
  years: number,
  baseCount: number,
  ctx: DummyRunContext
): Date[] {
  const dates: Date[] = [];
  for (const months of range(0, years * 12)) {
    const flow = getFlowConstantWithFlow(months, ctx.flow);
    const count = Math.ceil(flow * baseCount * (Math.random() * 0.25 + 0.75));
    dates.push(...getRandomDates(count, months));
  }

  return dates;
}

async function getSalesInvoices(
  fyo: Fyo,
  years: number,
  baseCount: number,
  notifier: Notifier | undefined,
  ctx: DummyRunContext
) {
  const invoices: SalesInvoice[] = [];
  const recvAccount = await defaultReceivableAccount(fyo);
  const salesItems = ctx.catalogItems.filter(
    (i) => i.forSalesOrPurchases !== 'Purchases'
  );
  const customers = ctx.catalogParties.filter((i) => i.role !== 'Supplier');

  /**
   * Get certain number of entries for each month of the count
   * of years.
   */
  const dates = getSalesInvoiceDates(years, baseCount, ctx);

  /**
   * For each date create a Sales Invoice.
   */

  for (let d = 0; d < dates.length; d++) {
    const date = dates[d];

    notifier?.(
      `Creating Sales Invoices, ${d} out of ${dates.length}`,
      safeParseInt(d) / dates.length
    );
    const customer = sample(customers);

    const doc = fyo.doc.getNewDoc(
      ModelNameEnum.SalesInvoice,
      {
        date,
      },
      false
    ) as SalesInvoice;

    await doc.set('party', customer!.name);
    if (!doc.account) {
      doc.account = recvAccount;
    }
    /**
     * Add `numItems` number of items to the invoice.
     */
    const numItems = Math.ceil(Math.random() * 5);
    for (let i = 0; i < numItems; i++) {
      const item = sample(salesItems);
      if ((doc.items ?? []).find((i) => i.item === item)) {
        continue;
      }

      let quantity = 1;

      /**
       * Increase quantity depending on the rate.
       */
      if (item!.rate < 100 && Math.random() < 0.4) {
        quantity = Math.ceil(Math.random() * 10);
      } else if (item!.rate < 1000 && Math.random() < 0.2) {
        quantity = Math.ceil(Math.random() * 4);
      } else if (Math.random() < 0.01) {
        quantity = Math.ceil(Math.random() * 3);
      }

      let fc = ctx.flow[date.getMonth()];
      if (baseCount < 500) {
        fc += 1;
      }
      const rate = fyo.pesa(item!.rate * (fc + 1)).clip(0);
      await doc.append('items', {});
      await doc.items!.at(-1)!.set({
        item: item!.name,
        rate,
        quantity,
        account: item!.incomeAccount,
        amount: rate.mul(quantity),
        tax: item!.tax,
        description: item!.description,
        hsnCode: item!.hsnCode,
      });
    }

    invoices.push(doc);
  }

  return invoices;
}

async function getPurchaseInvoices(
  fyo: Fyo,
  years: number,
  salesInvoices: SalesInvoice[],
  ctx: DummyRunContext
): Promise<PurchaseInvoice[]> {
  return [
    await getSalesPurchaseInvoices(fyo, salesInvoices, ctx),
    await getNonSalesPurchaseInvoices(fyo, years, ctx),
  ].flat();
}

async function getSalesPurchaseInvoices(
  fyo: Fyo,
  salesInvoices: SalesInvoice[],
  ctx: DummyRunContext
): Promise<PurchaseInvoice[]> {
  const invoices = [] as PurchaseInvoice[];
  const payAccount = await defaultPayableAccount(fyo);
  /**
   * Group all sales invoices by their YYYY-MM.
   */
  const dateGrouped = salesInvoices
    .map((si) => {
      const date = DateTime.fromJSDate(si.date as Date);
      const key = `${date.year}-${String(date.month).padStart(2, '0')}`;
      return { key, si };
    })
    .reduce((acc, item) => {
      acc[item.key] ??= [];
      acc[item.key].push(item.si);
      return acc;
    }, {} as Record<string, SalesInvoice[]>);

  /**
   * Sort the YYYY-MM keys in ascending order.
   */
  const dates = Object.keys(dateGrouped)
    .map((k) => ({ key: k, date: new Date(k) }))
    .sort((a, b) => +a.date - +b.date);
  const purchaseQty: Record<string, number> = {};

  /**
   * For each date create a set of Purchase Invoices.
   */
  for (const { key, date } of dates) {
    /**
     * Group items by name to get the total quantity used in a month.
     */
    const itemGrouped = dateGrouped[key].reduce((acc, si) => {
      for (const item of si.items!) {
        if (item.item === 'Dry-Cleaning') {
          continue;
        }

        acc[item.item as string] ??= 0;
        acc[item.item as string] += item.quantity as number;
      }

      return acc;
    }, {} as Record<string, number>);

    /**
     * Set order quantity for the first of the month.
     */
    Object.keys(itemGrouped).forEach((name) => {
      const quantity = itemGrouped[name];
      purchaseQty[name] ??= 0;
      let prevQty = purchaseQty[name];

      if (prevQty <= quantity) {
        prevQty = quantity - prevQty;
      }

      purchaseQty[name] = Math.ceil(prevQty / 10) * 10;
    });

    const supplierGrouped = Object.keys(itemGrouped).reduce((acc, item) => {
      const supplier = ctx.purchaseItemPartyMap[item];
      if (!supplier) {
        return acc;
      }
      acc[supplier] ??= [];
      acc[supplier].push(item);

      return acc;
    }, {} as Record<string, string[]>);

    /**
     * For each supplier create a Purchase Invoice
     */
    for (const supplier in supplierGrouped) {
      const doc = fyo.doc.getNewDoc(
        ModelNameEnum.PurchaseInvoice,
        {
          date,
        },
        false
      ) as PurchaseInvoice;

      await doc.set('party', supplier);
      if (!doc.account) {
        doc.account = payAccount;
      }

      /**
       * For each item create a row
       */
      for (const item of supplierGrouped[supplier]) {
        await doc.append('items', {});
        const quantity = purchaseQty[item];
        await doc.items!.at(-1)!.set({ item, quantity });
      }

      invoices.push(doc);
    }
  }

  return invoices;
}

async function getNonSalesPurchaseInvoices(
  fyo: Fyo,
  years: number,
  ctx: DummyRunContext
): Promise<PurchaseInvoice[]> {
  const payAccount = await defaultPayableAccount(fyo);
  const purchaseItems = ctx.catalogItems.filter(
    (i) => i.forSalesOrPurchases !== 'Sales'
  );
  const itemMap = getMapFromList(purchaseItems, 'name');
  const periodic = ctx.payload?.periodicPurchases ?? DEFAULT_PERIODIC_PURCHASES;
  const invoices: SalesInvoice[] = [];

  for (const months of range(0, years * 12)) {
    /**
     * All purchases on the first of the month.
     */
    const temp = DateTime.now().minus({ months });
    const date = DateTime.local(temp.year, temp.month, 1).toJSDate();

    for (const name in periodic) {
      if (months % periodic[name] !== 0) {
        continue;
      }

      const party = ctx.purchaseItemPartyMap[name];
      if (!party) {
        continue;
      }

      const item = itemMap[name];
      if (!item) {
        continue;
      }

      const doc = fyo.doc.getNewDoc(
        ModelNameEnum.PurchaseInvoice,
        {
          date,
        },
        false
      ) as PurchaseInvoice;

      await doc.set('party', party);
      if (!doc.account) {
        doc.account = payAccount;
      }
      await doc.append('items', {});
      const row = doc.items!.at(-1)!;

      let quantity = 1;
      let rate = item.rate;
      const rentLike =
        name === 'Office Rent' ||
        name.includes('إيجار') ||
        (typeof name === 'string' && name.toLowerCase().includes('rent'));
      if (item.rate < 120 && !rentLike) {
        quantity = Math.ceil(Math.random() * 200);
      } else if (!rentLike) {
        rate = rate * (Math.random() * 0.4 + 0.8);
      }

      await row.set({
        item: item.name,
        quantity,
        rate: fyo.pesa(rate).clip(0),
      });

      invoices.push(doc);
    }
  }

  return invoices;
}

async function generateStaticEntries(fyo: Fyo, ctx: DummyRunContext) {
  await generateItems(fyo, ctx);
  await generateParties(fyo, ctx);
}

async function generateItems(fyo: Fyo, ctx: DummyRunContext) {
  for (const raw of ctx.catalogItems) {
    const { forSalesOrPurchases, ...rest } = raw;
    const doc = fyo.doc.getNewDoc(
      'Item',
      { ...rest, for: forSalesOrPurchases },
      false
    );
    await doc.sync();
  }
}

async function generateParties(fyo: Fyo, ctx: DummyRunContext) {
  for (const raw of ctx.catalogParties) {
    const doc = fyo.doc.getNewDoc('Party', raw, false);
    await doc.sync();
  }
}

async function syncAndSubmit(docs: Doc[], notifier?: Notifier) {
  const nameMap: Record<string, string> = {
    [ModelNameEnum.PurchaseInvoice]: t`Invoices`,
    [ModelNameEnum.SalesInvoice]: t`Invoices`,
    [ModelNameEnum.Payment]: t`Payments`,
    [ModelNameEnum.JournalEntry]: t`Journal Entries`,
  };

  const total = docs.length;
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    notifier?.(
      `Syncing ${nameMap[doc.schemaName]}, ${i} out of ${total}`,
      safeParseInt(i) / total
    );
    await doc.sync();
    await doc.submit();
  }
}
