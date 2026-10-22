import { describe, expect, it } from 'vitest';
import { amanUntukPdf, kelompokkanProduksi, type BarisProduksi } from './production-list';

const baris = (over: Partial<BarisProduksi>): BarisProduksi => ({
  orderId: 'o1',
  externalOrderId: '260101AAAA',
  placedAt: '2026-10-01T00:00:00.000Z',
  shipByAt: '2026-10-05T00:00:00.000Z',
  sku: 'SHOPEE-1',
  produk: 'HADIST SUNAN ABU DAUD PERJILID',
  varian: 'Jilid 2',
  qty: 1,
  ...over,
});

describe('kelompokkan daftar produksi', () => {
  it('mengelompokkan per SKU dan menjumlahkan unit', () => {
    const hasil = kelompokkanProduksi([
      baris({ orderId: 'o1', qty: 2 }),
      baris({ orderId: 'o2', qty: 3 }),
      baris({ orderId: 'o3', sku: 'SHOPEE-2', produk: 'SET', varian: null, qty: 1 }),
    ]);
    expect(hasil.grup).toHaveLength(2);
    expect(hasil.grup[0]?.sku).toBe('SHOPEE-1');
    expect(hasil.grup[0]?.totalUnit).toBe(5);
    expect(hasil.grup[0]?.pesanan).toHaveLength(2);
    expect(hasil.totalPesanan).toBe(3);
    expect(hasil.totalUnit).toBe(6);
  });

  it('menghitung pesanan unik, bukan baris', () => {
    const hasil = kelompokkanProduksi([
      baris({ orderId: 'o1', sku: 'A' }),
      baris({ orderId: 'o1', sku: 'B' }),
    ]);
    expect(hasil.totalPesanan).toBe(1);
    expect(hasil.totalUnit).toBe(2);
  });

  it('di dalam grup, batas kirim terdekat naik ke atas', () => {
    const hasil = kelompokkanProduksi([
      baris({ orderId: 'lama', shipByAt: '2026-10-20T00:00:00.000Z' }),
      baris({ orderId: 'dekat', shipByAt: '2026-10-02T00:00:00.000Z' }),
    ]);
    expect(hasil.grup[0]?.pesanan.map((p) => p.orderId)).toEqual(['dekat', 'lama']);
  });

  it('daftar kosong menghasilkan struktur kosong', () => {
    expect(kelompokkanProduksi([])).toEqual({ grup: [], totalPesanan: 0, totalUnit: 0 });
  });
});

describe('pembersihan teks untuk PDF', () => {
  it('membuang emoji dan karakter di luar Latin-1', () => {
    expect(amanUntukPdf('Buku 📚 Jilid 1')).toBe('Buku Jilid 1');
  });

  it('menormalkan tanda kutip melengkung dan tanda pisah panjang', () => {
    expect(amanUntukPdf('“Set” — Jilid’s')).toBe('"Set" - Jilid\'s');
  });

  it('menjaga huruf beraksen tetap terbaca', () => {
    expect(amanUntukPdf('Café Résumé')).toBe('Cafe Resume');
  });
});
