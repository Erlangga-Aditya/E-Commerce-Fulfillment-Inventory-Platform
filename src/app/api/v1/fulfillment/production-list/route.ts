import { type NextRequest } from 'next/server';
import { ambilDataProduksi, buatPdfProduksi } from '@/modules/fulfillment/application/production-pdf';
import { handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, assertPermission } from '@/shared/application/routeHelpers';
import { auditLog } from '@/modules/audit/application/auditLog.service';

/**
 * GET /api/v1/fulfillment/production-list
 *
 * Mengunduh daftar produksi (PDF) untuk disetor ke tim produksi: hanya pesanan
 * yang barangnya belum ada di gudang, dikelompokkan per SKU.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.orders');

    const data = await ambilDataProduksi(ctx.tenantId);
    const pdf = await buatPdfProduksi({ ...data, dibuatOleh: 'Owner' });

    await auditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: 'production_list_printed',
      entityType: 'Order',
      entityId: data.kodeBatch,
      metadata: { batch: data.kodeBatch, pesanan: data.totalPesanan, unit: data.totalUnit },
    });

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
