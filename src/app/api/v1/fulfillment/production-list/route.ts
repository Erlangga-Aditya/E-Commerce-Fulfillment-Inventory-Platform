import { type NextRequest } from 'next/server';
import { ambilDataProduksi, buatPdfProduksi } from '@/modules/fulfillment/application/production-pdf';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, assertPermission } from '@/shared/application/routeHelpers';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { logger } from '@/shared/observability/logger';

/**
 * GET /api/v1/fulfillment/production-list
 *
 * Daftar pesanan yang barangnya belum ada, dikelompokkan per nama pendek
 * (SET dulu, lalu jilid). Dipakai halaman Produksi untuk memilih pesanan.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.orders');
    const data = await ambilDataProduksi(ctx.tenantId);
    return successResponse(
      {
        kodeBatch: data.kodeBatch,
        totalPesanan: data.totalPesanan,
        totalUnit: data.totalUnit,
        grup: data.grup.map((g) => ({
          nama: g.nama,
          jilid: g.jilid,
          totalUnit: g.totalUnit,
          pesanan: g.pesanan.map((p) => ({
            orderId: p.orderId,
            externalOrderId: p.externalOrderId,
            tanggal: p.placedAt,
            batasKirim: p.shipByAt,
            qty: p.qty,
            sku: p.sku,
          })),
        })),
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}

/**
 * POST /api/v1/fulfillment/production-list
 * Body: `{ orderIds?: string[] }` — kosong berarti semua pesanan yang menunggu.
 *
 * Menghasilkan PDF (Produk · Qty · Tanggal) hanya untuk pesanan yang dipilih.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.orders');

    const body = (await request.json().catch(() => ({}))) as { orderIds?: unknown };
    const orderIds = Array.isArray(body.orderIds) ? body.orderIds.map(String) : [];
    const data = await ambilDataProduksi(ctx.tenantId, { orderIds });
    const pdf = await buatPdfProduksi(data);

    await auditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'production_list_printed',
      entityType: 'Order',
      entityId: data.kodeBatch,
      metadata: {
        batch: data.kodeBatch,
        pesanan: data.totalPesanan,
        unit: data.totalUnit,
        dipilih: orderIds.length > 0,
      },
    });
    logger.info(`Daftar produksi dicetak: ${data.totalPesanan} pesanan`, { batch: data.kodeBatch });

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="daftar-produksi-${data.kodeBatch}.pdf"`,
        'Cache-Control': 'no-store',
        'X-Request-Id': requestId,
      },
    });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
