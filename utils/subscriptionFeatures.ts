export const SUBSCRIPTION_FEATURES = {
  enableDemo: 'enableDemo',
  enableDiscounting: 'enableDiscounting',
  enablePriceList: 'enablePriceList',
  enableFormCustomization: 'enableFormCustomization',
  enableLead: 'enableLead',
  enableItemEnquiry: 'enableItemEnquiry',
  enableLoyaltyProgram: 'enableLoyaltyProgram',
  enableInventory: 'enableInventory',
  enableInvoiceReturns: 'enableInvoiceReturns',
  enableERPNextSync: 'enableERPNextSync',
  enablePointOfSaleWithOutInventory: 'enablePointOfSaleWithOutInventory',
  enablePartialPayment: 'enablePartialPayment',
  enableitemGroup: 'enableitemGroup',
  enableCouponCode: 'enableCouponCode',
  enablePricingRule: 'enablePricingRule',
} as const;

export type SubscriptionFeatureKey =
  typeof SUBSCRIPTION_FEATURES[keyof typeof SUBSCRIPTION_FEATURES];

/**
 * Server uses snake_case keys; Books uses camelCase fieldnames.
 * Keep this centralized so the server->client mapping doesn't drift.
 */
export const SUBSCRIPTION_FEATURE_SERVER_MAP: Record<
  string,
  SubscriptionFeatureKey
> = {
  enable_demo: SUBSCRIPTION_FEATURES.enableDemo,
  enable_discounting: SUBSCRIPTION_FEATURES.enableDiscounting,
  enable_price_list: SUBSCRIPTION_FEATURES.enablePriceList,
  enable_form_customization: SUBSCRIPTION_FEATURES.enableFormCustomization,
  enable_lead: SUBSCRIPTION_FEATURES.enableLead,
  enable_item_enquiry: SUBSCRIPTION_FEATURES.enableItemEnquiry,
  enable_coupon_code: SUBSCRIPTION_FEATURES.enableCouponCode,
  enable_item_group: SUBSCRIPTION_FEATURES.enableitemGroup,
  enable_partial_payment: SUBSCRIPTION_FEATURES.enablePartialPayment,
  enable_inventory: SUBSCRIPTION_FEATURES.enableInventory,
  enable_invoice_returns: SUBSCRIPTION_FEATURES.enableInvoiceReturns,
  enable_erpnext_sync: SUBSCRIPTION_FEATURES.enableERPNextSync,
  enable_pricing_rule: SUBSCRIPTION_FEATURES.enablePricingRule,
  enable_loyalty_program: SUBSCRIPTION_FEATURES.enableLoyaltyProgram,
  enable_pos_without_inventory:
    SUBSCRIPTION_FEATURES.enablePointOfSaleWithOutInventory,
};
