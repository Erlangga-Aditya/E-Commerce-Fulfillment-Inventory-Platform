import crypto from 'crypto';
import { prisma } from '@/shared/infrastructure/prisma';
import { ShopeeAdapter } from '../infrastructure/shopee.adapter';
import { encryptSecret, decryptSecret } from '../infrastructure/crypto.service';
import { importOrder } from '@/modules/orders/application/order.usecase';
import { processOrderForFulfillment } from '@/modules/fulfillment/application/fulfillment.usecase';
import { NotFoundError, ExternalIntegrationError } from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { logger } from '@/shared/observability/logger';

const shopee = new ShopeeAdapter();

interface StoredCredentials {
  shopId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number; // epoch ms
  mainAccountId?: string;
}

async function loadConnection(tenantId: string, shopId: string) {
  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } });
  if (!shop) throw new NotFoundError('Toko', shopId);

  const conn = await prisma.integrationConnection.findFirst({
    where: { shopId, provider: 'shopee' },
  });
  if (!conn?.encryptedCredentials) {
    throw new ExternalIntegrationError('shopee', 'Koneksi Shopee belum dikonfigurasi. Hubungkan toko terlebih dahulu.');
  }
  const creds = JSON.parse(decryptSecret(conn.encryptedCredentials)) as StoredCredentials;
  return { shop, conn, creds };
}

/** Refresh access_token if expired/near-expiry; persist new tokens (encrypted). */
async function ensureFreshToken(connId: string, creds: StoredCredentials): Promise<StoredCredentials> {
  const now = Date.now();
  if (creds.tokenExpiresAt - now > 5 * 60 * 1000) return creds; // still valid >5min

  const refreshed = await shopee.refreshAccessToken(creds.refreshToken, creds.shopId);
  const next: StoredCredentials = {
    ...creds,
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    tokenExpiresAt: now + refreshed.expire_in * 1000,
  };
  await prisma.integrationConnection.update({
    where: { id: connId },
    data: { encryptedCredentials: encryptSecret(JSON.stringify(next)), status: 'ACTIVE', lastSyncAt: new Date() },
  });
  logger.info('Shopee token refreshed', { shopId: creds.shopId });
  return next;
}

/** Map Shopee order_status → internal OrderStatus (provider-specific). */
function mapShopeeStatusToInternal(status: string): 'NEW' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' {
  switch (status) {
    case 'UNPAID':
    case 'PENDING':
    case 'IN_CANCEL':
      return 'NEW';
    case 'READY_TO_SHIP':
    case 'PROCESSED':
    case 'RETRY_SHIP':
    case 'SHIPPED':
    case 'TO_CONFIRM_RECEIVE':
      return 'CONFIRMED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'COMPLETED':
      return 'COMPLETED';
    default:
      return 'NEW';
  }
}

/** Resolve or create a local variant from a marketplace SKU. */
async function resolveVariant(tenantId: string, sku: string) {
  const variant = await prisma.productVariant.findFirst({
    where: { product: { tenantId }, sku },
  });
  return variant;
}

export async function triggerOrderSync(tenantId: string, shopId: string, actorId: string) {
  const { conn, creds } = await loadConnection(tenantId, shopId);
  const fresh = await ensureFreshToken(conn.id, creds);

  const syncRun = await prisma.syncRun.create({
    data: { tenantId, shopId, operation: 'import_orders', status: 'RUNNING' },
  });

  const warehouse = await prisma.warehouse.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' } });

  try {
    const credentials = {
      shopId: fresh.shopId,
      accessToken: fresh.accessToken,
      partnerId: process.env.SHOPEE_PARTNER_ID ?? '',
      partnerKey: process.env.SHOPEE_PARTNER_KEY ?? '',
    };

    const orders = await shopee.getOrders(credentials, {});
    let recordsWritten = 0;

    for (const mOrder of orders) {
      // Map items to local variants by SKU.
      const items: Array<{ variantId: string; quantity: number; unitPrice?: number }> = [];
      for (const mi of mOrder.items) {
        const variant = await resolveVariant(tenantId, mi.sku);
        if (variant) {
          items.push({ variantId: variant.id, quantity: mi.quantity, unitPrice: mi.unitPrice });
        }
      }
      if (items.length === 0) {
        logger.warn('Order tanpa varian yang cocok, dilewati', { externalOrderId: mOrder.externalOrderId });
        continue;
      }

      const result = await importOrder(tenantId, {
        shopId,
        externalOrderId: mOrder.externalOrderId,
        placedAt: mOrder.placedAt,
        shipByAt: mOrder.shipByAt,
        buyerName: mOrder.buyerName,
        buyerPhone: mOrder.buyerPhone,
        shippingAddress: mOrder.shippingAddress,
        status: mapShopeeStatusToInternal(mOrder.rawStatus),
        items,
      });

      // Auto-process CONFIRMED orders (reserve + create fulfillment) when a warehouse exists.
      if (result.created && warehouse && mapShopeeStatusToInternal(mOrder.rawStatus) === 'CONFIRMED') {
        try {
          await processOrderForFulfillment(tenantId, result.orderId, warehouse.id, actorId);
        } catch (err) {
          logger.warn('Gagal memproses fulfillment otomatis', { orderId: result.orderId, error: (err as Error).message });
        }
      }
      if (result.created) recordsWritten++;
    }

    const completed = await prisma.syncRun.update({
      where: { id: syncRun.id },
      data: { status: 'COMPLETED', recordsRead: orders.length, recordsWritten, finishedAt: new Date() },
    });

    await auditLog({
      tenantId, actorId, action: 'sync_orders_complete', entityType: 'Shop', entityId: shopId,
      metadata: { recordsRead: orders.length, recordsWritten },
    });

    return completed;
  } catch (err) {
    const msg = (err as Error).message || 'Sync error';
    await prisma.syncRun.update({ where: { id: syncRun.id }, data: { status: 'FAILED', errorMessage: msg, finishedAt: new Date() } });
    throw new ExternalIntegrationError('shopee', msg);
  }
}

/**
 * Process a verified Shopee push (webhook). Idempotent: the unique constraint on
 * (shopId, provider, externalEventId) is enforced atomically by create-then-catch.
 */
export async function processWebhookEvent(
  tenantId: string,
  shopId: string,
  provider: string,
  externalEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<{ status: string }> {
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

  try {
    const created = await prisma.webhookEvent.create({
      data: { tenantId, shopId, provider, externalEventId, eventType, payloadHash, status: 'PROCESSING' },
    });

    // Handle order status push (code 3) → reconcile order status.
    const data = (payload.data ?? {}) as Record<string, unknown>;
    if (eventType === 'order_status_push' && data.ordersn) {
      const status = mapShopeeStatusToInternal(String(data.status ?? ''));
      const order = await prisma.order.findUnique({
        where: { shopId_externalOrderId: { shopId, externalOrderId: String(data.ordersn) } },
      });
      if (order && order.status !== status) {
        await importOrder(tenantId, {
          shopId,
          externalOrderId: String(data.ordersn),
          placedAt: order.placedAt,
          shipByAt: order.shipByAt ?? undefined,
          buyerName: order.buyerName,
          buyerPhone: order.buyerPhone,
          shippingAddress: (order.shippingAddress as Record<string, unknown>) ?? undefined,
          status,
          items: [{ variantId: '', quantity: 1 }], // placeholder; importOrder reconciles existing without touching items
        });
      }
    }

    await prisma.webhookEvent.update({ where: { id: created.id }, data: { status: 'PROCESSED', processedAt: new Date() } });
    return { status: 'PROCESSED' };
  } catch (err) {
    // Duplicate → already processed.
    if ((err as { code?: string }).code === 'P2002') {
      logger.info(`Webhook duplikat diabaikan: ${externalEventId}`);
      return { status: 'SKIPPED' };
    }
    await prisma.webhookEvent.updateMany({
      where: { shopId, provider, externalEventId },
      data: { status: 'FAILED', errorMessage: (err as Error).message },
    });
    throw err;
  }
}

export async function listSyncRuns(tenantId: string, shopId?: string) {
  return prisma.syncRun.findMany({
    where: { tenantId, ...(shopId ? { shopId } : {}) },
    include: { shop: { select: { name: true, provider: true } } },
    orderBy: { startedAt: 'desc' },
    take: 50,
  });
}

/** Connect Shopee by storing (encrypted) seller tokens + setting the external shop id. */
export async function connectShopee(
  tenantId: string,
  shopId: string,
  input: { externalShopId: string; accessToken: string; refreshToken: string; tokenExpiresAt?: number; mainAccountId?: string },
) {
  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } });
  if (!shop) throw new NotFoundError('Toko', shopId);

  const creds = {
    shopId: input.externalShopId,
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    tokenExpiresAt: input.tokenExpiresAt ?? Date.now() + 4 * 3600 * 1000,
    ...(input.mainAccountId ? { mainAccountId: input.mainAccountId } : {}),
  };
  const encrypted = encryptSecret(JSON.stringify(creds));
  const sandbox = process.env.SHOPEE_SANDBOX === 'true';

  await prisma.$transaction(async (tx) => {
    await tx.integrationConnection.upsert({
      where: { shopId_provider: { shopId, provider: 'shopee' } },
      create: { shopId, provider: 'shopee', encryptedCredentials: encrypted, status: 'ACTIVE', sandbox },
      update: { encryptedCredentials: encrypted, status: 'ACTIVE', sandbox, lastSyncAt: new Date() },
    });
    await tx.shop.update({ where: { id: shopId }, data: { externalShopId: input.externalShopId } });
  });

  return { connected: true, externalShopId: input.externalShopId, sandbox };
}

export async function getShopeeConnectionStatus(tenantId: string, shopId: string) {
  const shop = await prisma.shop.findFirst({ where: { id: shopId, tenantId } });
  if (!shop) throw new NotFoundError('Toko', shopId);
  const conn = await prisma.integrationConnection.findFirst({ where: { shopId, provider: 'shopee' } });
  const partnerConfigured = Boolean(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY);
  return {
    connected: Boolean(conn?.encryptedCredentials),
    status: conn?.status ?? 'PENDING',
    sandbox: conn?.sandbox ?? (process.env.SHOPEE_SANDBOX === 'true'),
    lastSyncAt: conn?.lastSyncAt ?? null,
    partnerConfigured,
    externalShopId: shop.externalShopId,
  };
}

