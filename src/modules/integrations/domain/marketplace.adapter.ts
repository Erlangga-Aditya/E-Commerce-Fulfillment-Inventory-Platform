/**
 * Marketplace Adapter Interface (Port) — ADR-006.
 * The domain/application layer depends on this interface, never on a provider SDK.
 * Shopee is the only implemented provider (ShopeeAdapter); the port remains a
 * clean seam so other channels can be added without touching the order domain.
 */

export interface MarketplaceOrderItem {
  externalItemId: string;
  externalVariantId: string;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface MarketplaceOrder {
  externalOrderId: string;
  placedAt: Date;
  shipByAt: Date | null;
  buyerName: string | null;
  buyerPhone: string | null;
  shippingAddress: Record<string, unknown>;
  items: MarketplaceOrderItem[];
  rawStatus: string;
  trackingNumber: string | null;
  carrier: string | null;
}

export interface MarketplaceProductVariant {
  externalVariantId: string;
  sku: string;
  barcode?: string | null;
  name: string;
  price?: number | null;
  stock?: number | null;
}

export interface MarketplaceProduct {
  externalProductId: string;
  name: string;
  sku: string;
  price: number | null;
  imageUrl: string | null;
  variants: MarketplaceProductVariant[];
}

export interface TrackingEvent {
  externalEventId: string;
  status: string;
  description: string;
  occurredAt: Date;
}

export interface TrackingInfo {
  awb: string;
  carrier: string;
  status: string;
  events: TrackingEvent[];
}

// ── Logistics / Shipping ──────────────────────────────────────────────────────

export interface ArrangeShipmentInput {
  /** Shopee internal order_sn. */
  orderSn: string;
  /** Shopee package_number (from package_list in order detail). */
  packageNumber?: string;
  /** Pickup or dropoff — default 'dropoff' if not specified. */
  pickupTimeId?: string;
  /** For dropoff: branch_id obtained from get_branch_list. */
  branchId?: number;
}

export interface ArrangeShipmentResult {
  success: boolean;
  trackingNumber: string | null;
  message?: string;
}

export interface SyncOptions {
  fromDate?: Date;
  toDate?: Date;
  pageSize?: number;
}

export interface ShopCredentials {
  /** Provider shop id (Shopee numeric shop_id). */
  shopId: string;
  accessToken: string;
  partnerId: string;
  partnerKey: string;
  /** Override API host (e.g. sandbox). */
  apiHost?: string;
}

// ── Returns ───────────────────────────────────────────────────────────────────

export interface MarketplaceReturnItem {
  externalItemId: string;
  externalVariantId: string;
  sku: string;
  name: string;
  quantity: number;
}

export interface MarketplaceReturn {
  externalReturnId: string;
  externalOrderId: string;
  /** Provider-specific status string (e.g. "REQUESTED", "ACCEPTED"). */
  status: string;
  reason: string;
  items: MarketplaceReturnItem[];
  createdAt: Date;
}

// ── Adapter Interface ─────────────────────────────────────────────────────────

export interface MarketplaceAdapter {
  readonly provider: string;
  getOrders(credentials: ShopCredentials, options?: SyncOptions): Promise<MarketplaceOrder[]>;
  getOrderDetail(credentials: ShopCredentials, externalOrderId: string): Promise<MarketplaceOrder | null>;
  getProducts(credentials: ShopCredentials): Promise<MarketplaceProduct[]>;
  getReturns(credentials: ShopCredentials): Promise<MarketplaceReturn[]>;
  updateStock(credentials: ShopCredentials, externalVariantId: string, quantity: number): Promise<boolean>;
  /** Fetch AWB/resi number from logistics provider. */
  getTrackingNumber(credentials: ShopCredentials, orderSn: string): Promise<string | null>;
  /** Fetch full tracking info (AWB + events). */
  getTrackingInfo(credentials: ShopCredentials, orderSn: string): Promise<TrackingInfo | null>;
  /** Trigger "Atur Pengiriman" for an incoming order (required before AWB is issued). */
  arrangeShipment(credentials: ShopCredentials, input: ArrangeShipmentInput): Promise<ArrangeShipmentResult>;
  /** Generate / download shipping label URL for printing. */
  printShippingLabel(credentials: ShopCredentials, orderSn: string, packageNumber?: string): Promise<string | null>;
  /** Verify a webhook/push signature (provider-specific). */
  verifyWebhookSignature(url: string, rawBody: string, signature: string, partnerKey: string): boolean;
}
