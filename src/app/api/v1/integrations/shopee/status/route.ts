import { type NextRequest } from 'next/server';
import { getShopeeConnectionStatus } from '@/modules/integrations/application/sync.service';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, getQueryParam } from '@/shared/application/routeHelpers';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const shopId = getQueryParam(request, 'shopId');
    if (!shopId) return successResponse({ connected: false, partnerConfigured: Boolean(process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_PARTNER_KEY) }, { requestId });
    const status = await getShopeeConnectionStatus(ctx.tenantId, shopId);
    return successResponse(status, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
