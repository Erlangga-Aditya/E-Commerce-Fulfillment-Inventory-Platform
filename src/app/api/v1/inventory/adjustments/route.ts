import { type NextRequest } from 'next/server';
import {
  adjustStock,
  AdjustStockSchema,
} from '@/modules/inventory/application/inventory.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, assertRole } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

// POST /api/v1/inventory/adjustments
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);

  try {
    const ctx = getAuthContext(request);
    assertRole(ctx, 'MANAGER'); // Only MANAGER+ can adjust stock

    const body: unknown = await request.json();
    const parsed = AdjustStockSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError('Data penyesuaian tidak valid.', {
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    await adjustStock(ctx.tenantId, parsed.data, ctx.userId);

    return successResponse({ message: 'Stok berhasil disesuaikan.' }, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
