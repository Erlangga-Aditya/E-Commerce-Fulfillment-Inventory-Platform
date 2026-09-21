import crypto from 'crypto';
import type {
  MarketplaceAdapter,
  MarketplaceOrder,
  MarketplaceProduct,
  ShopCredentials,
  SyncOptions,
  TrackingInfo,
} from '../domain/marketplace.adapter';
import { logger } from '@/shared/observability/logger';

/**
 * Real Shopee Open Platform v2 adapter (partner/ISV app).
 *
 * Every fact below was VERIFIED against the official docs (2026-09-17), see
 * 08-INTEGRATION-SHOPEE.md and the research reference. Key rules:
 *  - Sign = HMAC-SHA256(partner_id + api_path + timestamp + access_token + shop_id) → lowercase HEX.
 *    Public API omits access_token/shop_id.
 *  - POST: common params in query string, request params in JSON body.
 *  - get_order_list window max 15 days, cursor pagination.
 *  - access_token 4h, refresh_token 30d (single-use), code 10min.
 */

export interface ShopeeTokenResponse {
  access_token: string;
  refresh_token: string;
  expire_in: number; // seconds
  shop_id_list?: number[];
  merchant_id_list?: number[];
}

interface ShopeeConfig {
  partnerId: string;
  partnerKey: string;
  apiHost: string;
}

function configFromEnv(): ShopeeConfig {
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  if (!partnerId || !partnerKey) {
    throw new Error('SHOPEE_PARTNER_ID dan SHOPEE_PARTNER_KEY wajib disetel sebelum integrasi Shopee digunakan.');
  }
  const apiHost =
    (process.env.SHOPEE_SANDBOX === 'true' ? process.env.SHOPEE_SANDBOX_HOST : undefined) ??
    process.env.SHOPEE_API_HOST ??
    'https://partner.shopeemobile.com';
  return { partnerId, partnerKey, apiHost };
}

function buildBaseString(partnerId: string, apiPath: string, timestamp: number, accessToken?: string, shopId?: string): string {
  let base = `${partnerId}${apiPath}${timestamp}`;
  if (accessToken) base += accessToken;
  if (shopId !== undefined && shopId !== '') base += shopId;
  return base;
}

export function signShopee(partnerId: string, partnerKey: string, apiPath: string, timestamp: number, accessToken?: string, shopId?: string): string {
  return crypto.createHmac('sha256', partnerKey).update(buildBaseString(partnerId, apiPath, timestamp, accessToken, shopId)).digest('hex');
}

interface ShopeeError {
  error: string;
  message: string;
  request_id?: string;
  response?: unknown;
}

async function callShopee<T>(cfg: ShopeeConfig, apiPath: string, body: Record<string, unknown>, creds?: { shopId?: string; accessToken?: string }): Promise<T> {
  const timestamp = Math.floor(Date.now() / 1000);
  const shopId = creds?.shopId;
  const accessToken = creds?.accessToken;
  const sign = signShopee(cfg.partnerId, cfg.partnerKey, apiPath, timestamp, accessToken, shopId);

  const url = new URL(apiPath, cfg.apiHost);
  url.searchParams.set('partner_id', cfg.partnerId);
  url.searchParams.set('timestamp', String(timestamp));
  url.searchParams.set('sign', sign);
  if (accessToken) url.searchParams.set('access_token', accessToken);
  if (shopId) url.searchParams.set('shop_id', shopId);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`Tidak dapat terhubung ke Shopee API: ${(err as Error).message}`);
  }

  const json = (await res.json()) as ShopeeError & Record<string, unknown>;
  if (json.error && json.error !== '') {
    const msg = `Shopee API error [${json.error}] ${json.message ?? ''}`;
    logger.error(msg, { apiPath, request_id: json.request_id });
    throw new Error(msg);
  }
  return (json.response as T) ?? (json as unknown as T);
}

function toDate(ts: unknown): Date | null {
  if (typeof ts !== 'number' || ts <= 0) return null;
  return new Date(ts * 1000);
}

/** Map Shopee order_status → internal rawStatus string (kept provider-agnostic upstream). */
export function mapShopeeOrderStatus(status: string): string {
  // Pass-through; the sync service maps to internal OrderStatus enum.
  return status;
}

export class ShopeeAdapter implements MarketplaceAdapter {
  readonly provider = 'shopee';

  private cfg(): ShopeeConfig {
    return configFromEnv();
  }

  /** Build the authorization URL (seller grants access). */
  buildAuthUrl(redirectUri: string, state?: string): string {
    const { partnerId } = this.cfg();
    const sandbox = process.env.SHOPEE_SANDBOX === 'true';
    const base = sandbox ? 'https://open.sandbox.test-stable.shopee.com/auth' : 'https://open.shopee.com/auth';
    const params = new URLSearchParams({
      partner_id: partnerId,
      auth_type: 'seller',
      redirect_uri: redirectUri,
      response_type: 'code',
    });
    if (state) params.set('state', state);
    return `${base}?${params.toString()}`;
  }

  /** Exchange authorization `code` → tokens (public API). */
  async exchangeCodeForToken(code: string, shopId?: string, mainAccountId?: string): Promise<ShopeeTokenResponse> {
    const cfg = this.cfg();
    const body: Record<string, unknown> = { code, partner_id: cfg.partnerId };
    if (shopId) body.shop_id = Number(shopId);
    if (mainAccountId) body.main_account_id = Number(mainAccountId);
    const res = await callShopee<Record<string, unknown>>(cfg, '/api/v2/auth/token/get', body);
    return res as unknown as ShopeeTokenResponse;
  }

  /** Refresh access_token using a single-use refresh_token (public API). */
  async refreshAccessToken(refreshToken: string, shopId: string): Promise<ShopeeTokenResponse> {
    const cfg = this.cfg();
    const res = await callShopee<Record<string, unknown>>(cfg, '/api/v2/auth/access_token/get', {
      refresh_token: refreshToken,
      partner_id: cfg.partnerId,
      shop_id: Number(shopId),
    });
    return res as unknown as ShopeeTokenResponse;
  }

  private async getOrderList(cfg: ShopeeConfig, creds: ShopCredentials, options?: SyncOptions): Promise<Array<{ orderSn: string; status: string }>> {
    const now = Math.floor(Date.now() / 1000);
    const to = options?.toDate ? Math.floor(options.toDate.getTime() / 1000) : now;
    const from = options?.fromDate ? Math.floor(options.fromDate.getTime() / 1000) : to - 15 * 24 * 3600;

    const results: Array<{ orderSn: string; status: string }> = [];
    let cursor = '';
    let more = true;

    while (more) {
      const res = await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/order/get_order_list',
        {
          time_range_field: 'create_time',
          time_from: from,
          time_to: to,
          page_size: 100,
          cursor,
          response_optional_fields: 'order_status',
          request_order_status_pending: true,
        },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      const list = (res?.order_list as Array<{ order_sn?: string; order_status?: string }>) ?? [];
      for (const o of list) {
        if (o.order_sn) results.push({ orderSn: o.order_sn, status: o.order_status ?? '' });
      }
      more = (res?.more as boolean) === true;
      cursor = (res?.next_cursor as string) ?? '';
      if (!more) break;
    }
    return results;
  }

  private async getOrderDetails(cfg: ShopeeConfig, creds: ShopCredentials, orderSns: string[]): Promise<Record<string, unknown>[]> {
    const all: Record<string, unknown>[] = [];
    const OPTIONAL = 'buyer_username,recipient_address,item_list,pay_time,payment_method,package_list,shipping_carrier,total_amount,currency,cod,note';
    for (let i = 0; i < orderSns.length; i += 50) {
      const batch = orderSns.slice(i, i + 50);
      const res = await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/order/get_order_detail',
        { order_sn_list: batch.join(','), response_optional_fields: OPTIONAL, request_order_status_pending: true },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      const list = (res?.order_list as Record<string, unknown>[]) ?? [];
      all.push(...list);
    }
    return all;
  }

  async getOrders(creds: ShopCredentials, options?: SyncOptions): Promise<MarketplaceOrder[]> {
    const cfg = this.cfg();
    const summaries = await this.getOrderList(cfg, creds, options);
    if (summaries.length === 0) return [];
    const details = await this.getOrderDetails(cfg, creds, summaries.map((s) => s.orderSn));
    return details.map((d) => this.mapOrder(d)).filter((o): o is MarketplaceOrder => o !== null);
  }

  async getOrderDetail(creds: ShopCredentials, externalOrderId: string): Promise<MarketplaceOrder | null> {
    const cfg = this.cfg();
    const details = await this.getOrderDetails(cfg, creds, [externalOrderId]);
    return details.length ? this.mapOrder(details[0]!) : null;
  }

  private mapOrder(d: Record<string, unknown>): MarketplaceOrder | null {
    const orderSn = typeof d.order_sn === 'string' ? d.order_sn : null;
    if (!orderSn) return null;

    const itemsRaw = (d.item_list as Array<Record<string, unknown>>) ?? [];
    const items = itemsRaw.map((it) => ({
      externalItemId: String(it.item_id ?? ''),
      externalVariantId: String(it.model_id ?? it.item_id ?? ''),
      sku: String(it.model_sku ?? it.item_sku ?? ''),
      name: String(it.model_name ?? it.item_name ?? ''),
      quantity: Number(it.model_quantity_purchased ?? it.model_quantity ?? 1),
      unitPrice: Number(it.model_discounted_price ?? it.model_original_price ?? 0),
    }));

    const recipient = (d.recipient_address ?? {}) as Record<string, unknown>;
    const packages = (d.package_list as Array<Record<string, unknown>>) ?? [];
    const firstPackage = packages[0] ?? {};
    const trackingNumber =
      (firstPackage.tracking_number as string) ?? (firstPackage.tracking_no as string) ?? null;

    return {
      externalOrderId: orderSn,
      placedAt: toDate(d.create_time) ?? new Date(),
      shipByAt: toDate(d.ship_by_date),
      buyerName: (d.buyer_username as string) ?? null,
      buyerPhone: (recipient.phone as string) ?? null,
      shippingAddress: {
        name: recipient.name ?? null,
        phone: recipient.phone ?? null,
        fullAddress: recipient.full_address ?? null,
        city: recipient.city ?? null,
        district: recipient.district ?? null,
        state: recipient.state ?? null,
        region: recipient.region ?? null,
        town: recipient.town ?? null,
        zipcode: recipient.zipcode ?? null,
      },
      items,
      rawStatus: String(d.order_status ?? ''),
      trackingNumber,
      carrier: (firstPackage.shipping_carrier as string) ?? null,
    };
  }

  async getProducts(creds: ShopCredentials): Promise<MarketplaceProduct[]> {
    const cfg = this.cfg();
    // 1. get_item_list (offset pagination)
    const itemIds: string[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const res = await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/product/get_item_list',
        { offset, page_size: 100, item_status: ['NORMAL'] },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      const list = (res?.item as Array<Record<string, unknown>>) ?? [];
      for (const it of list) if (it.item_id) itemIds.push(String(it.item_id));
      if (!res?.has_next_item) break;
    }
    if (itemIds.length === 0) return [];

    // 2. get_item_base_info (batches of 50)
    const products: MarketplaceProduct[] = [];
    for (let i = 0; i < itemIds.length; i += 50) {
      const res = await callShopee<Record<string, unknown>>(
        cfg,
        '/api/v2/product/get_item_base_info',
        { item_id_list: itemIds.slice(i, i + 50).map((x) => Number(x)) },
        { shopId: creds.shopId, accessToken: creds.accessToken },
      );
      const list = (res?.item_list as Array<Record<string, unknown>>) ?? [];
      for (const it of list) {
        const priceInfo = (it.price_info ?? {}) as Record<string, unknown>;
        products.push({
          externalProductId: String(it.item_id),
          name: String(it.item_name ?? ''),
          sku: String(it.item_sku ?? ''),
          price: priceInfo.current_price != null ? Number(priceInfo.current_price) : null,
          imageUrl: null,
          variants: [],
        });
      }
    }
    return products;
  }

  async updateStock(creds: ShopCredentials, externalVariantId: string, quantity: number): Promise<boolean> {
    // Requires per-model stock_list shape; verify against sandbox before enabling writes.
    // Implemented as a safe no-op returning false until validated — never fake success.
    logger.warn('updateStock belum diaktifkan — validasi struktur stock_list di sandbox terlebih dahulu.', {
      shopId: creds.shopId,
      externalVariantId,
      quantity,
    });
    return false;
  }

  async getTrackingInfo(creds: ShopCredentials, orderSn: string): Promise<TrackingInfo | null> {
    const cfg = this.cfg();
    const res = await callShopee<Record<string, unknown>>(
      cfg,
      '/api/v2/logistics/get_tracking_info',
      { order_sn: orderSn },
      { shopId: creds.shopId, accessToken: creds.accessToken },
    );
    const info = (res?.tracking_info ?? res) as Record<string, unknown>;
    if (!info) return null;
    const trackingList = (info.tracking_list as Array<Record<string, unknown>>) ?? [];
    return {
      awb: String(info.tracking_number ?? info.tracking_no ?? orderSn),
      carrier: String(info.logistics_channel_name ?? info.shipping_carrier ?? ''),
      status: String(info.logistics_status ?? ''),
      events: trackingList.map((e, idx) => ({
        externalEventId: String(e.logistics_event_id ?? `${orderSn}-${idx}`),
        status: String(e.status ?? ''),
        description: String(e.description ?? ''),
        occurredAt: toDate(e.event_time) ?? new Date(),
      })),
    };
  }

  verifyWebhookSignature(url: string, rawBody: string, signature: string, partnerKey: string): boolean {
    // Verified: HMAC-SHA256(url + "|" + raw_body, partner_key) → lowercase HEX, in `Authorization` header.
    const expected = crypto.createHmac('sha256', partnerKey).update(`${url}|${rawBody}`).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature.toLowerCase()));
  }
}
