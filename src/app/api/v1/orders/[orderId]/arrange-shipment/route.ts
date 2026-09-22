import { type NextRequest } from 'next/server';
import { arrangeShipmentForOrder } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

type Ctx = { params: Promise<{ orderId: string }> };

/**
 * POST /api/v1/orders/[orderId]/arrange-shipment
 * Mengatur pengiriman pesanan ke Shopee logistics/init.
 * Diperlukan sebelum AWB (nomor resi) bisa diperoleh.
 *
 * Body: { shopId: string, packageNumber?: string, pickupTimeId?: string, branchId?: number }
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { orderId } = await params;
    const body = (await request.json()) as {
      shopId?: string;
      packageNumber?: string;
      pickupTimeId?: string;
      branchId?: number;
    };

    if (!body.shopId) throw new ValidationError('shopId wajib diisi (ID toko di sistem kami, bukan Shopee shop_id).');

    const result = await arrangeShipmentForOrder(
      ctx.tenantId,
      body.shopId,
      orderId,
      {
        packageNumber: body.packageNumber,
        pickupTimeId: body.pickupTimeId,
        branchId: body.branchId,
      },
      ctx.userId,
    );

    return successResponse(
      {
        message: result.success
          ? `Pengiriman berhasil diatur. Nomor resi: ${result.trackingNumber ?? 'menunggu'}`
          : `Atur pengiriman gagal: ${result.message}`,
        ...result,
      },
      { requestId },
    );
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
