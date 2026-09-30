import { type NextRequest } from 'next/server';
import {
  getFulfillmentStation,
  STATION_STAGES,
  type StationStage,
} from '@/modules/fulfillment/application/fulfillment.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import {
  getAuthContext,
  getRequestId,
  getQueryParam,
  parsePagination,
  assertPermission,
} from '@/shared/application/routeHelpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/fulfillment/station
 *
 * Satu endpoint untuk STASIUN KERJA (halaman Operasi Harian):
 * semua yang perlu dikerjakan operator hari ini, tanpa perlu pindah menu.
 *  - queue      : fulfillment order aktif (WAITING_STOCK … READY_TO_SHIP) + item + shortfall + AWB
 *  - newOrders  : pesanan baru yang belum masuk antrian (perlu "Proses")
 *  - warehouse  : gudang default yang dipakai untuk memproses
 *
 * Mendukung penyaringan per tahap dan pagination:
 *   ?stage=BARU|MENUNGGU_STOK|SIAP_DIKEMAS|SIAP_KIRIM|DIKIRIM|DIBATALKAN|SELESAI
 *   ?resi=sudah|belum
 *   ?search=<nomor pesanan | nomor resi | nama pembeli | SKU>
 *   ?page=1&pageSize=20
 * Jawabannya menyertakan `total`, `totalPages`, dan `truncated` supaya
 * antarmuka tidak pernah menyembunyikan data tanpa memberi tahu.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    assertPermission(ctx, 'page.orders');
    const sortParam = getQueryParam(request, 'sort');
    const { page, pageSize } = parsePagination(request);
    const stageParam = getQueryParam(request, 'stage');
    const stage = STATION_STAGES.includes(stageParam as StationStage)
      ? (stageParam as StationStage)
      : null;
    // Penyaring resi hanya menerima dua nilai yang dikenal. Nilai lain diabaikan
    // - bukan diteruskan - supaya permintaan yang salah tidak diam-diam
    // menghasilkan daftar yang berbeda dari yang dimaksud pemakainya.
    const resiParam = getQueryParam(request, 'resi');
    const resi = resiParam === 'sudah' || resiParam === 'belum' ? resiParam : null;
    const station = await getFulfillmentStation(ctx.tenantId, {
      sort: sortParam === 'newest' ? 'newest' : 'oldest',
      stage,
      resi,
      search: getQueryParam(request, 'search'),
      page,
      pageSize,
    });
    return successResponse(station, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
