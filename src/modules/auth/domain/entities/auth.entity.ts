/**
 * Auth Domain Entities
 * These are pure domain types — no ORM dependencies.
 * (Clean Architecture: domain must not import infrastructure)
 */

/**
 * Role yang tersedia di aplikasi.
 *
 * SENGAJA HANYA `OWNER`.
 *
 * Keputusan bisnis: struktur role akan dideklarasikan ulang lengkap (siapa bisa
 * akses apa, dan actions apa yang boleh dilakukan) setelah dipetakan dari
 * kebutuhan nyata. Sampai saat itu, satu role berarti satu orang bertanggung
 * jawab penuh - jadi lebih aman daripada menyimpan role yang belum punya
 * arti jelas tapi sudah jadi kode produksi.
 *
 * Endpoint yang dulu memakai role lain sudah dikunci ke `OWNER`.
 */
export type UserRole = 'OWNER';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';

export interface User {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  createdAt: Date;
}

export interface TenantMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: UserRole;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: Date;
}

/**
 * Auth context extracted from JWT — available on every authenticated request.
 * Injected by middleware; used by use cases for authorization.
 */
export interface AuthContext {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
}

// ────────────────────────────────────────────────────────────
// Allowed role transitions / permission matrix
// ────────────────────────────────────────────────────────────

/** Hanya ada satu role, jadi hierarki tidak perlu dihitung. */
export function hasMinimumRole(userRole: UserRole, requiredRole: UserRole): boolean {
  return userRole === 'OWNER' && requiredRole === 'OWNER';
}
