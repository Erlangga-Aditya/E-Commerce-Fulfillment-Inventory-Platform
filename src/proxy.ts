import { type NextRequest, NextResponse } from 'next/server';
import { verifyJwt, AUTH_COOKIE } from '@/modules/auth/infrastructure/jwt.service';
import { AUTH_CONTEXT_HEADER } from '@/shared/application/httpHeaders';

const PUBLIC_API = [
  '/api/v1/auth/login',
  '/api/v1/auth/logout',
  '/api/v1/health',
  '/api/v1/integrations/shopee/webhook',
  '/api/v1/integrations/shopee/callback',
];

function redirectToLogin(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: 'Autentikasi diperlukan.' }, meta: { requestId: crypto.randomUUID() } },
    { status: 401 },
  );
}

/**
 * Authentication via httpOnly cookie (best practice — no XSS-exposed token).
 * - API: verifies cookie, injects verified auth context header.
 * - /dashboard pages: redirects unauthenticated users to /login.
 * - Sanitizes spoofable identity headers so tenant/user can never come from the client (FR-AUTH-003).
 */
/** Halaman & endpoint yang sengaja dihapus (seller individual). */
const REMOVED_PATHS = ['/register', '/api/v1/auth/register'];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Pendaftaran publik tidak ada. Akun hanya sah bila dibuat di Seller Centre
  // Shopee, jadi halaman dan endpointnya harus benar-benar mati, bukan sekadar
  // disembunyikan dari menu.
  if (REMOVED_PATHS.includes(pathname)) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Pendaftaran lewat aplikasi tidak tersedia.' }, meta: { requestId: crypto.randomUUID() } },
        { status: 404 },
      );
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Always strip spoofable identity headers.
  const headers = new Headers(request.headers);
  headers.delete(AUTH_CONTEXT_HEADER);
  headers.delete('x-tenant-id');
  headers.delete('x-user-id');

  const token = request.cookies.get(AUTH_COOKIE)?.value;

  if (pathname.startsWith('/api/v1/')) {
    if (PUBLIC_API.includes(pathname)) {
      return NextResponse.next({ request: { headers } });
    }
    if (!token) return unauthorized();
    try {
      const ctx = await verifyJwt(token);
      headers.set(AUTH_CONTEXT_HEADER, JSON.stringify(ctx));
      return NextResponse.next({ request: { headers } });
    } catch {
      return unauthorized();
    }
  }

  if (pathname.startsWith('/dashboard')) {
    if (!token) return redirectToLogin(request);
    try {
      const ctx = await verifyJwt(token);
      headers.set(AUTH_CONTEXT_HEADER, JSON.stringify(ctx));
      return NextResponse.next({ request: { headers } });
    } catch {
      return redirectToLogin(request);
    }
  }

  // Akar domain: pengguna yang sudah punya sesi tidak perlu melihat halaman
  // login lagi.
  if (pathname === '/') {
    if (!token) return redirectToLogin(request);
    try {
      await verifyJwt(token);
      return NextResponse.redirect(new URL('/dashboard', request.url));
    } catch {
      return redirectToLogin(request);
    }
  }

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/api/v1/:path*', '/dashboard/:path*', '/dashboard', '/', '/register', '/api/v1/auth/register'],
};
