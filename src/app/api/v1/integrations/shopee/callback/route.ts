import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ShopeeAdapter } from '@/modules/integrations/infrastructure/shopee.adapter';
import { connectShopee } from '@/modules/integrations/application/sync.service';
import { logger } from '@/shared/observability/logger';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const shopId = searchParams.get('shop_id');
  const mainAccountId = searchParams.get('main_account_id');
  const state = searchParams.get('state');

  const fallback = NextResponse.redirect(new URL('/dashboard/integrasi', request.url));

  try {
    if (!code) throw new Error('Tidak ada code dari Shopee.');
    if (!state) throw new Error('State tidak ditemukan.');
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as { tenantId: string; shopId: string };
    const adapter = new ShopeeAdapter();
    const tokens = await adapter.exchangeCodeForToken(code, shopId ?? undefined, mainAccountId ?? undefined);
    await connectShopee(decoded.tenantId, decoded.shopId, {
      externalShopId: String(shopId ?? tokens.shop_id_list?.[0] ?? ''),
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: Date.now() + tokens.expire_in * 1000,
      ...(tokens.merchant_id_list?.[0] ? { mainAccountId: String(tokens.merchant_id_list[0]) } : {}),
    });
    return fallback;
  } catch (err) {
    logger.error('Shopee OAuth callback gagal', { error: (err as Error).message });
    const url = new URL('/dashboard/integrasi', request.url);
    url.searchParams.set('error', 'oauth');
    return NextResponse.redirect(url);
  }
}
