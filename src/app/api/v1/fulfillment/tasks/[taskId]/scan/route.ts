import { type NextRequest } from 'next/server';
import { processScan } from '@/modules/fulfillment/application/fulfillment.usecase';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';
import { z } from 'zod';

const ScanSchema = z.object({
  scannedCode: z.string().min(1, 'Kode scan tidak boleh kosong.'),
  quantity: z.number().int().positive().default(1),
});

// POST /api/v1/fulfillment/tasks/[taskId]/scan
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const requestId = getRequestId(request);

  try {
    const ctx = getAuthContext(request);
    const { taskId } = await params;

    const body: unknown = await request.json();
    const parsed = ScanSchema.safeParse(body);

    if (!parsed.success) {
      throw new ValidationError('Data scan tidak valid.', {
        fields: parsed.error.flatten().fieldErrors,
      });
    }

    const result = await processScan(
      ctx.tenantId,
      taskId,
      parsed.data.scannedCode,
      parsed.data.quantity,
    );

    // Return with appropriate HTTP status for scan results
    // 200 for success or known business error (not HTTP error)
    return successResponse(result, { requestId });
  } catch (error) {
    return handleRouteError(error, requestId, request);
  }
}
