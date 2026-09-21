import { type NextRequest } from 'next/server';
import { triggerOrderSync, listSyncRuns } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, getQueryParam } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const shopId = getQueryParam(request, 'shopId');
    const runs = await listSyncRuns(ctx.tenantId, shopId);
    return successResponse(runs, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const body: unknown = await request.json();
    const shopId = (body as { shopId?: string }).shopId;
    if (!shopId) throw new ValidationError('shopId wajib diisi.');
    const result = await triggerOrderSync(ctx.tenantId, shopId, ctx.userId);
    return successResponse({ message: 'Sinkronisasi pesanan selesai.', syncRun: result }, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
