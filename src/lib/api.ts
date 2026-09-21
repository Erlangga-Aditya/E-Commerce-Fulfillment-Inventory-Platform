/**
 * Typed API client for the internal v1 API.
 * The session is an httpOnly cookie (sent automatically on same-origin fetch),
 * so no token handling is needed client-side.
 */
export interface ApiError extends Error {
  code?: string;
  details?: Record<string, unknown>;
}

export async function api<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: options?.method ?? 'GET',
    headers: options?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { code?: string; message?: string; details?: Record<string, unknown> };
    meta?: { pagination?: { total?: number; page?: number; pageSize?: number; hasMore?: boolean } };
  };

  if (!res.ok) {
    const err = new Error(json.error?.message ?? 'Terjadi kesalahan. Silakan coba lagi.') as ApiError;
    err.code = json.error?.code;
    err.details = json.error?.details;
    throw err;
  }

  return json.data as T;
}

export interface Pagination {
  total: number;
  page: number;
  pageSize: number;
  hasMore?: boolean;
}

export function formatRupiah(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
