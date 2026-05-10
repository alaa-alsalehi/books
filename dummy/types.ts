/**
 * Payload returned by rukn_books_subscription.api.get_demo_dataset
 * and consumed by setupDummyInstance.
 */
export type DemoDatasetPayload = {
  key: string;
  options: {
    companyName: string;
    fullname?: string;
    email?: string;
    bankName?: string;
    country: string;
    currency: string;
    chartOfAccounts: string;
    fiscalYearStartMD: string;
    fiscalYearEndMD: string;
  };
  address: {
    addressLine1?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  accounting: {
    taxId?: string;
    phone?: string;
  };
  printSettings: {
    color?: string;
    displayLogo?: boolean;
  };
  items: DemoItemSeed[];
  parties: DemoPartySeed[];
  partyPurchaseItemMap: Record<string, string[]>;
  flow: number[];
  periodicPurchases?: Record<string, number>;
};

export type DemoItemSeed = {
  name: string;
  description?: string | null;
  unit: string;
  itemType: string;
  incomeAccount: string;
  expenseAccount: string;
  tax?: string;
  rate: number;
  hsnCode?: string | null;
  /** Sales / Purchases / Both (maps to Item.for when syncing). */
  forSalesOrPurchases: string;
  image?: string;
};

export type DemoPartySeed = {
  name: string;
  role: string;
  defaultAccount: string;
  currency: string;
  email?: string | null;
  phone?: string | null;
  gstType?: string | null;
  gstin?: string | null;
};
