import { type NextRequest } from 'next/server';
import { completePacking } from '@/modules/fulfillment/application/fulfillment.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';
import { z } from 'zod';

const PackSchema = z.object({ notes: z.string().max(500).optional() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ fulfillmentOrderId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const { fulfillmentOrderId } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    const parsed = PackSchema.safeParse(body ?? {});
    if (!parsed.success) throw new ValidationError('Data tidak valid.');
    await completePacking(ctx.tenantId, fulfillmentOrderId, ctx.userId, parsed.data.notes);
    return successResponse({ message: 'Packing berhasil dikonfirmasi.' }, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
