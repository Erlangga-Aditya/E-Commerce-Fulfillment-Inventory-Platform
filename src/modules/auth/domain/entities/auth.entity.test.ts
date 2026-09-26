import { describe, it, expect } from 'vitest';
import { hasMinimumRole } from './auth.entity';
import type { UserRole } from './auth.entity';

/**
 * Regresi untuk "hapus semua kodingan role kecuali owner".
 *
 * Role lain (MANAGER / FINANCE / STAFF) dulu ada di tipe, hierarki, dan UI.
 * Kalau salah satu masih lolos, aplikasi kembali punya label akses yang
 * aturannya tidak pernah diuji — dan itucil_new yang paling berbahaya.
 */
describe('Role aplikasi hanya OWNER', () => {
  it('OWNER memenuhi syarat OWNER', () => {
    expect(hasMinimumRole('OWNER', 'OWNER')).toBe(true);
  });

  it('tipe UserRole hanya menerima OWNER', () => {
    // Dicek pada level tipe:.Role lama harus TIDAK bisa dikompilasi.
    const onlyOwner: UserRole = 'OWNER';
    expect(onlyOwner).toBe('OWNER');

    // @ts-expect-error 'STAFF' sudah dihapus dari tipe UserRole.
    const legacy: UserRole = 'STAFF';
    expect(legacy).toBeDefined();
  });

  it('menolak role yang sudah dihapus saat runtime (fail-closed)', () => {
    // Data lama atau token lama bisa membawa role yang tidak dikenal lagi.
    // Fungsi ini tidak boleh meloloskan nilai asing hanya karena perbandingan
    // string tidak error.
    const rogue = 'STAFF' as UserRole;

    expect(hasMinimumRole(rogue, 'OWNER')).toBe(false);
  });
});
