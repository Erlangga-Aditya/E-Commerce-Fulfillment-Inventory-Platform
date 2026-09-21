import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ShopeeAdapter } from '@/modules/integrations/infrastructure/shopee.adapter';
import { processWebhookEvent } from '@/modules/integrations/application/sync.service';
import { prisma } from '@/shared/infrastructure/prisma';
import { logger } from '@/shared/observability/logger';

const PUSH_EVENT_TYPES: Record<number, string> = {
  1: 'shop_authorization_push', 2: 'shop_authorization_canceled_push', 3: 'order_status_push',
  4: 'order_trackingno_push', 5: 'shopee_updates_push', 12: 'authorization_expiry_push',
  15: 'shipping_document_status_push', 29: 'return_updates_push', 30: 'package_fulfillment_status_push',
};

/** ACK Shopee push: 2xx + empty body. */
function ack(): NextResponse {
  return new NextResponse(null, { status: 200 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get('authorization') ?? '';
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;

  try {
    if (!partnerKey) {
      logger.warn('Webhook diterima tetapi SHOPEE_PARTNER_KEY belum disetel — tidak bisa verifikasi.');
      return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }
    if (!signature) return NextResponse.json({ error: 'missing_signature' }, { status: 401 });

    const adapter = new ShopeeAdapter();
    if (!adapter.verifyWebhookSignature(request.url, rawBody, signature, partnerKey)) {
      return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
    }

    const payload = JSON.parse(rawBody) as { data?: Record<string, unknown>; shop_id?: number; code?: number; timestamp?: number };
    const code = payload.code ?? 0;
    const eventType = PUSH_EVENT_TYPES[code] ?? `push_${code}`;
    const data = payload.data ?? {};

    // Resolve tenant via external shop id.
    const shop = await prisma.shop.findFirst({
      where: { provider: 'shopee', externalShopId: String(payload.shop_id ?? '') },
      include: { tenant: true },
    });
    if (!shop) {
      logger.warn('Webhook untuk shop yang tidak terdaftar', { shopId: payload.shop_id });
      return ack(); // still ACK to avoid retry storm
    }

    const key = data.ordersn ?? data.order_sn ?? data.return_sn ?? data.booking_sn ?? '';
    const externalEventId = `${payload.shop_id}-${code}-${key}-${data.update_time ?? payload.timestamp ?? ''}`;

    await processWebhookEvent(shop.tenantId, shop.id, 'shopee', externalEventId, eventType, payload as unknown as Record<string, unknown>);
    return ack();
  } catch (err) {
    logger.error('Webhook processing gagal', { error: (err as Error).message });
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
