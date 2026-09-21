import { type NextRequest } from 'next/server';
import { handOverToCarrier } from '@/modules/fulfillment/application/fulfillment.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { z } from 'zod';

const HandoverSchema = z.object({ carrier: z.string().optional(), awb: z.string().optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ fulfillmentOrderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { fulfillmentOrderId } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const parsed = HandoverSchema.safeParse(body ?? {});
    const result = await handOverToCarrier(ctx.tenantId, fulfillmentOrderId, ctx.userId, parsed.success ? parsed.data.carrier : undefined, parsed.success ? parsed.data.awb : undefined);
    return successResponse({ message: 'Pesanan diserahkan ke kurir.', shipmentId: result.shipmentId }, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
