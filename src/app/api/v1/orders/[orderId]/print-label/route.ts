import { type NextRequest } from 'next/server';
import { generateShippingLabel } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

type Ctx = { params: Promise<{ orderId: string }> };

/**
 * POST /api/v1/orders/[orderId]/print-label
 * Generate URL cetak label pengiriman dari Shopee.
 * Body: { shopId: string, packageNumber?: string }
 * Returns: { labelUrl: string | null, orderSn: string }
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { orderId } = await params;
    const body = (await request.json().catch(() => ({}))) as { shopId?: string; packageNumber?: string };

    const result = await generateShippingLabel(
      ctx.tenantId,
      body.shopId || '',
      orderId,
      body.packageNumber,
    );

    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
