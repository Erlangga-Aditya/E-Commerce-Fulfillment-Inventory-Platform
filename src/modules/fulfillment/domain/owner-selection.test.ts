import { describe, expect, it } from 'vitest';
import { MAKS_PILIHAN, susunSaran, validasiSeleksi } from './owner-selection';

const now = new Date('2026-10-20T03:00:00.000Z');
const jam = (n: number) => new Date(now.getTime() + n * 3_600_000).toISOString();

describe('saran urutan kerja owner', () => {
  it('mengurutkan berdasarkan batas kirim terdekat', () => {
    const hasil = susunSaran(
      [
        { orderId: 'c', externalOrderId: 'C', placedAt: jam(-1), shipByAt: jam(72) },
        { orderId: 'a', externalOrderId: 'A', placedAt: jam(-30), shipByAt: jam(5) },
        { orderId: 'b', externalOrderId: 'B', placedAt: jam(-10), shipByAt: jam(24) },
      ],
      now,
    );
    expect(hasil.map((h) => h.orderId)).toEqual(['a', 'b', 'c']);
    expect(hasil[0]?.alasan).toBe('Tersisa 5 jam');
  });

  it('pesanan tanpa batas kirim ditaruh paling belakang', () => {
    const hasil = susunSaran(
      [
        { orderId: 'x', externalOrderId: 'X', placedAt: jam(-100), shipByAt: null },
        { orderId: 'y', externalOrderId: 'Y', placedAt: jam(-1), shipByAt: jam(48) },
      ],
      now,
    );
    expect(hasil.map((h) => h.orderId)).toEqual(['y', 'x']);
    expect(hasil[1]?.alasan).toBe('Tanpa batas kirim');
  });

  it('batas kirim sama → pesanan yang masuk lebih dulu didahulukan', () => {
    const hasil = susunSaran(
      [
        { orderId: 'baru', externalOrderId: 'N', placedAt: jam(-1), shipByAt: jam(10) },
        { orderId: 'lama', externalOrderId: 'L', placedAt: jam(-9), shipByAt: jam(10) },
      ],
      now,
    );
    expect(hasil.map((h) => h.orderId)).toEqual(['lama', 'baru']);
  });

  it('menandai pesanan yang sudah melewati batas kirim', () => {
    const hasil = susunSaran(
      [{ orderId: 'l', externalOrderId: 'L', placedAt: jam(-50), shipByAt: jam(-3) }],
      now,
    );
    expect(hasil[0]?.sisaJam).toBe(-3);
    expect(hasil[0]?.alasan).toBe('Terlambat 3 jam');
  });
});

describe('validasi aksi seleksi', () => {
  it('menerima KERJAKAN dengan satu pesanan', () => {
    expect(validasiSeleksi({ orderIds: ['a'], aksi: 'KERJAKAN' })).toEqual({ ok: true });
  });

  it('menolak aksi yang tidak dikenal', () => {
    const h = validasiSeleksi({ orderIds: ['a'], aksi: 'HAPUS' });
    expect(h.ok).toBe(false);
  });

  it('menolak daftar kosong', () => {
    expect(validasiSeleksi({ orderIds: [], aksi: 'KERJAKAN' }).ok).toBe(false);
  });

  it('menolak melebihi batas sekali proses', () => {
    const ids = Array.from({ length: MAKS_PILIHAN + 1 }, (_, i) => `o${i}`);
    const h = validasiSeleksi({ orderIds: ids, aksi: 'KERJAKAN' });
    expect(h.ok).toBe(false);
  });

  it('menolak pesanan ganda', () => {
    expect(validasiSeleksi({ orderIds: ['a', 'a'], aksi: 'KERJAKAN' }).ok).toBe(false);
  });

  it('TUNDA wajib beralasan jelas', () => {
    expect(validasiSeleksi({ orderIds: ['a'], aksi: 'TUNDA', alasan: 'nanti' }).ok).toBe(false);
    expect(
      validasiSeleksi({ orderIds: ['a'], aksi: 'TUNDA', alasan: 'Menunggu bahan jilid 2' }).ok,
    ).toBe(true);
  });
});
