import { type NextRequest } from 'next/server';
import { ShopeeAdapter } from '@/modules/integrations/infrastructure/shopee.adapter';
import { successResponse, handleRouteError } from '@/shared/application/apiResponse';
import { getAuthContext, getRequestId, getQueryParam } from '@/shared/application/routeHelpers';
import { ValidationError } from '@/shared/errors/AppError';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const ctx = getAuthContext(request);
    const shopId = getQueryParam(request, 'shopId');
    if (!shopId) throw new ValidationError('shopId wajib diisi.');
    if (!process.env.SHOPEE_PARTNER_ID || !process.env.SHOPEE_PARTNER_KEY) {
      throw new ValidationError('Kredensial partner Shopee belum disetel di .env.');
    }
    const adapter = new ShopeeAdapter();
    const redirectUri = process.env.SHOPEE_REDIRECT_URL || `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/v1/integrations/shopee/callback`;
    const state = Buffer.from(JSON.stringify({ tenantId: ctx.tenantId, shopId })).toString('base64url');
    const url = adapter.buildAuthUrl(redirectUri, state);
    return successResponse({ url }, { requestId });
  } catch (error) { return handleRouteError(error, requestId, request); }
}
