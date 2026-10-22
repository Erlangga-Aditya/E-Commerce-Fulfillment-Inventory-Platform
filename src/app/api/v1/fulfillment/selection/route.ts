import { type NextRequest } from 'next/server';
import { getSaranKerja, terapkanSeleksi } from '@/modules/fulfillment/application/selection.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, assertPermission } from '@/shared/application/routeHelpers';

/** GET /api/v1/fulfillment/selection — saran urutan kerja untuk owner. */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.orders');
    const limitParam = Number(new URL(request.url).searchParams.get('limit') ?? 12);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 12;
    return successResponse({ saran: await getSaranKerja(ctx.tenantId, new Date(), limit) }, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

/**
 * POST /api/v1/fulfillment/selection
 * Body: `{ orderIds: string[], aksi: "KERJAKAN" | "TUNDA", alasan?: string }`
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'order.pick');
    const body = (await request.json()) as { orderIds?: unknown; aksi?: unknown; alasan?: unknown };
    const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(String) : [];
    const hasil = await terapkanSeleksi(ctx.tenantId, ctx.userId, {
      orderIds,
      aksi: String(body.aksi ?? ''),
      alasan: body.alasan == null ? null : String(body.alasan),
    });
    return successResponse(hasil, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
