import { type NextRequest } from 'next/server';
import { triggerOrderSync, listSyncRuns } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  getQueryParam,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { resolveShopId } from '@/modules/integrations/application/resolveShopId';

/**
 * GET  /api/v1/integrations/shopee/sync?shopId=...&operation=... — daftar sync run pesanan
 * POST /api/v1/integrations/shopee/sync — trigger sinkronisasi pesanan
 */

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'shopee.sync');
    const shopId = getQueryParam(request, 'shopId');
    const operation = getQueryParam(request, 'operation') ?? 'import_orders';
    const runs = await listSyncRuns(ctx.tenantId, {
      shopId,
      operation: operation ? [operation] : undefined,
    });
    return successResponse(runs, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'shopee.sync');
    // Body boleh kosong: `resolveShopId` memakai toko tunggal yang terhubung.
    const body = (await request.json().catch(() => ({}))) as { shopId?: string };
    const shopId = await resolveShopId(ctx.tenantId, body.shopId);
    const result = await triggerOrderSync(ctx.tenantId, shopId, ctx.userId);
    return successResponse(
      { message: 'Sinkronisasi pesanan selesai.', syncRun: result },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
