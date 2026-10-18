import { type NextRequest } from 'next/server';
import { triggerHistoricalSync } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  assertPermission,
} from '@/shared/application/routeHelpers';
import { resolveShopId } from '@/modules/integrations/application/resolveShopId';

/**
 * POST /api/v1/integrations/shopee/historical-sync
 *
 * Memicu penarikan data pesanan historis Shopee (hingga 6 tahun / rentang waktu kustom).
 * Shopee Open API membatasi get_order_list maksimal 15 hari per permintaan.
 * Endpoint ini mengeksekusi penarikan bertahap (chunked 14 hari) mundur secara teratur
 * dan mengimpor seluruh pesanan + varian yang hilang tanpa duplikasi.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'shopee.sync');

    const body = (await request.json().catch(() => ({}))) as {
      shopId?: string;
      fromDate?: string;
      toDate?: string;
      months?: number;
      chunkDays?: number;
    };

    const shopId = await resolveShopId(ctx.tenantId, body.shopId);

    const result = await triggerHistoricalSync(ctx.tenantId, shopId, ctx.userId, {
      fromDate: body.fromDate,
      toDate: body.toDate,
      months: body.months,
      chunkDays: body.chunkDays,
    });

    return successResponse(
      {
        message: `Sinkronisasi data historis selesai: ${result.recordsWritten} pesanan baru diimpor dari ${result.recordsRead} pesanan dalam ${result.processedChunks} chunks.`,
        result,
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
