import { type NextRequest } from 'next/server';
import { triggerTrackingSync, listSyncRuns } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, getQueryParam } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';
import { prisma } from '@/shared/infrastructure/prisma';

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
    // operator. Body kosong kini menjadi 400 VALIDATION_ERROR yang jelas.
    // daripada 500 INTERNAL_ERROR yang tidak menjelaskan apa pun ke operator.
    const body = (await request.json().catch(() => ({}))) as { shopId?: string };
    // Toko boleh dilewati: bila hanya ada satu toko terhubung (situasi umum
    // seller individual), picking otomatisnya tidak perlu menebak.
    let shopId = body.shopId;
    if (!shopId) {
      const shops = await prisma.shop.findMany({
        where: { tenantId: ctx.tenantId },
        select: { id: true },
        take: 2,
      });
      if (shops.length === 1 && shops[0]) {
        shopId = shops[0].id;
      } else {
        throw new ValidationError(
          shops.length === 0
            ? 'Belum ada toko Shopee yang terhubung.'
            : 'Ada lebih dari satu toko. Pilih toko yang mau disinkronkan.',
        );
      }
    }
    const result = await triggerTrackingSync(ctx.tenantId, shopId, ctx.userId);
    return successResponse(
      { message: 'Sinkronisasi tracking selesai.', syncRun: result },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
