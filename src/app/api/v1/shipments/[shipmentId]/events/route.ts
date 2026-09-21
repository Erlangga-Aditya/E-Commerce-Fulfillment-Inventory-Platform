import { type NextRequest } from 'next/server';
import { addShipmentEvent, AddShipmentEventSchema } from '@/modules/shipping/application/shipping.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

export async function POST(request: NextRequest, { params }: { params: Promise<{ shipmentId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { shipmentId } = await params;
    const body: unknown = await request.json();
    const validated = AddShipmentEventSchema.parse(body);
    await addShipmentEvent(ctx.tenantId, shipmentId, validated, ctx.userId);
    return successResponse({ message: 'Event pelacakan berhasil ditambahkan.' }, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
