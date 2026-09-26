import { type NextRequest } from 'next/server';
import { triggerTrackingSync, listSyncRuns } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, getQueryParam } from '@/shared/application/routeHelpers';
import { resolveShopId } from '@/modules/integrations/application/resolveShopId';

/**
 * GET  /api/v1/integrations/shopee/sync-tracking — daftar sync run tracking
 * POST /api/v1/integrations/shopee/sync-tracking — trigger sinkronisasi tracking
 */

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const shopId = getQueryParam(request, 'shopId');
    const runs = await listSyncRuns(ctx.tenantId, { shopId, operation: ['sync_tracking'] });
    return successResponse(runs, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    // `request.json()` melempar SyntaxError untuk body kosong, dan itu akan
    // berubah menjadi 500 INTERNAL_ERROR yang tidak menjelaskan apa pun ke
    // operator. Body kosong kini diperlakukan sebagai permintaan tanpa filter.
    const body = (await request.json().catch(() => ({}))) as { shopId?: string };
    const shopId = await resolveShopId(ctx.tenantId, body.shopId);
    const result = await triggerTrackingSync(ctx.tenantId, shopId, ctx.userId);
    return successResponse(
      { message: 'Sinkronisasi tracking selesai.', syncRun: result },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
