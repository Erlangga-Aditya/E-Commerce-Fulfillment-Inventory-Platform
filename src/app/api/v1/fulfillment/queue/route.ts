import { type NextRequest } from 'next/server';
import { getFulfillmentQueue } from '@/modules/fulfillment/application/fulfillment.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';

// GET /api/v1/fulfillment/queue?warehouseId=...&page=1
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const ctx = getAuthContext(request);
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') as
      | 'WAITING_STOCK' | 'READY_TO_PICK' | 'PICKING' | 'PICKED' | 'PACKING' | 'PACKED' | 'READY_TO_SHIP' | 'HANDED_OVER' | 'COMPLETED' | 'EXCEPTION'
      | undefined;
    const page = Number(searchParams.get('page') ?? '1');
    const pageSize = Math.min(Number(searchParams.get('pageSize') ?? '50'), 100);

    const result = await getFulfillmentQueue(ctx.tenantId, { status, page, pageSize });

    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
