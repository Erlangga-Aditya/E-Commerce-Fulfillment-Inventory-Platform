import { describe, expect, it } from 'vitest';
import {
  TAHAP_OPERASIONAL,
  hitungPerPelaku,
  hitungTahap,
  tahapDariStatus,
} from './operation-metrics';

describe('pemetaan tahap operasional', () => {
  it('memetakan status pekerjaan ke tahap yang dipahami owner', () => {
    expect(tahapDariStatus('WAITING_STOCK')).toBe('perluProduksi');
    expect(tahapDariStatus('READY_TO_PICK')).toBe('siapDiambil');
    expect(tahapDariStatus('PICKED')).toBe('sedangDipacking');
    expect(tahapDariStatus('PACKING')).toBe('sedangDipacking');
    expect(tahapDariStatus('PACKED')).toBe('siapDiserahkan');
    expect(tahapDariStatus('HANDED_OVER')).toBe('sudahDiserahkan');
    expect(tahapDariStatus('EXCEPTION')).toBe('gagal');
  });

  it('status yang tidak relevan (COMPLETED) tidak masuk tahap mana pun', () => {
    expect(tahapDariStatus('COMPLETED')).toBeNull();
    expect(tahapDariStatus('ENTAH')).toBeNull();
  });

  it('menghitung jumlah per tahap dan mengabaikan status tak dikenal', () => {
    const hasil = hitungTahap(['WAITING_STOCK', 'WAITING_STOCK', 'PICKED', 'PACKED', 'COMPLETED']);
    expect(hasil.perluProduksi).toBe(2);
    expect(hasil.sedangDipacking).toBe(1);
    expect(hasil.siapDiserahkan).toBe(1);
    expect(hasil.sudahDiserahkan).toBe(0);
    expect(Object.keys(hasil).sort()).toEqual(Object.keys(TAHAP_OPERASIONAL).sort());
  });
});

describe('jumlah paket per pelaku', () => {
  it('menjumlahkan per orang dan mengurutkan dari terbanyak', () => {
    const { daftar, tanpaNama } = hitungPerPelaku([
      { id: 'u1', nama: 'Sari' },
      { id: 'u2', nama: 'Budi' },
      { id: 'u2', nama: 'Budi' },
      { id: 'u2', nama: 'Budi' },
    ]);
    expect(tanpaNama).toBe(0);
    expect(daftar).toEqual([
      { id: 'u2', nama: 'Budi', jumlah: 3 },
      { id: 'u1', nama: 'Sari', jumlah: 1 },
    ]);
  });

  it('data lama tanpa pelaku dihitung terpisah, bukan disembunyikan', () => {
    const { daftar, tanpaNama } = hitungPerPelaku([
      { id: null, nama: null },
      { id: null, nama: null },
      { id: 'u1', nama: 'Sari' },
    ]);
    expect(tanpaNama).toBe(2);
    expect(daftar).toHaveLength(1);
  });

  it('nama kosong diganti penanda supaya baris tetap terbaca', () => {
    const { daftar } = hitungPerPelaku([{ id: 'u9', nama: null }]);
    expect(daftar[0]?.nama).toBe('(tanpa nama)');
  });
});
