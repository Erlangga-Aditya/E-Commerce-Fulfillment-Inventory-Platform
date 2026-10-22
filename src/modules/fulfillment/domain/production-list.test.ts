import { describe, expect, it } from 'vitest';
import { amanUntukPdf, isSet, jilidDari, kelompokkanProduksi, namaPendek, type BarisProduksi } from './production-list';

describe('nama pendek untuk lembar produksi', () => {
  const kasus: [string, string | null, string][] = [
    ['HADIST SUNAN ABU DAUD PERJILID DARUL HIKMAH HARD COVER', 'Jilid 1', 'Abu Daud Jilid 1'],
    ['HADIST SUNAN ABU DAUD PERJILID DARUL HIKMAH HARD COVER', 'Jilid 4', 'Abu Daud Jilid 4'],
    ['HADIST SUNAN ABU DAWUD SET DARUL HIKMAH HARD COVER', null, 'Abu Daud Set'],
    ['ALQURAN MAKNA COMBI', null, 'ALQURAN COMBI'],
    ['ALQURAN MAKNA POCKET TASIDJAWA', null, 'ALQURAN POCKET'],
    ['HADIST SHOHIH MUSLIM SET DARUL HIKMAH', null, 'Muslim Set'],
    ['HADIST SHOHIH MUSLIM DARUL HIKMAH PERJILID HARD COVER', 'Jilid 3', 'Muslim Jilid 3'],
    ['HADIST SUNAN TIRMIDZI DARUL HIKMAH PERJILID HARD COVER', 'Jilid 5', 'Tirmidzi Jilid 5'],
    ['HADIST SUNAN TIRMIDZI SET DARUL HIKMAH HARD COVER', null, 'Tirmidzi Set'],
    ['HADITS SUNAN IBNU MAJAH SET DARUL HIKMAH HARDCOVER', null, 'Ibnu Majah Set'],
    ['HADIST SUNAN IBNU MAJAH DARUL HIKMAH PERJILID HARD COVER', 'Jilid 2', 'Ibnu Majah Jilid 2'],
    ['HADIST SUNAN NASAI DARUL HIKMAH PERJILID HARD COVER', 'Jilid 1', 'Nasai Jilid 1'],
    ['HADIST SUNAN NASAI SET DARUL HIKMAH HARD COVER', null, 'Nasai Set'],
    ['HADIST SOHIH BUKHORI DARUL HIKMAH PERJILID HARD COVER', 'Jilid 6', 'Bukhori Jilid 6'],
    ['HADIST SOHIH BUKHORI DARUL HIKMAH SET 6 JILID, HARDCOVER.', null, 'Bukhori Set'],
  ];

  it.each(kasus)('%s (%s) → %s', (produk, varian, harapan) => {
    expect(namaPendek(produk, varian)).toBe(harapan);
  });

  it('varian "Jilid i" (salah ketik dari Shopee) tetap terbaca sebagai Jilid 1', () => {
    expect(namaPendek('HADIST SUNAN ABU DAUD PERJILID DARUL HIKMAH HARD COVER', 'Jilid i')).toBe('Abu Daud Jilid 1');
  });

  it('produk set dikenali, produk perjilid tidak', () => {
    expect(isSet('HADIST SOHIH BUKHORI DARUL HIKMAH SET 6 JILID, HARDCOVER.')).toBe(true);
    expect(isSet('HADIST SOHIH BUKHORI DARUL HIKMAH PERJILID HARD COVER')).toBe(false);
  });

  it('nama di luar daftar tetap terbaca (buang kata pemasaran)', () => {
    expect(namaPendek('BUKU SAKU DARUL HIKMAH HARD COVER')).toBe('Buku Saku');
  });
});

describe('nomor jilid', () => {
  it('membaca angka, romawi, dan kata', () => {
    expect(jilidDari('Jilid 3')).toBe(3);
    expect(jilidDari('JILID IV')).toBe(4);
    expect(jilidDari('jilid i')).toBe(1);
    expect(jilidDari('6')).toBe(6);
    expect(jilidDari(null)).toBeNull();
  });
});

const baris = (over: Partial<BarisProduksi>): BarisProduksi => ({
  orderId: 'o1',
  externalOrderId: '260101AAAA',
  placedAt: '2026-10-01T00:00:00.000Z',
  shipByAt: '2026-10-05T00:00:00.000Z',
  sku: 'SHOPEE-1',
  produk: 'HADIST SUNAN NASAI DARUL HIKMAH PERJILID HARD COVER',
  varian: 'Jilid 1',
  qty: 1,
  ...over,
});

describe('kelompokkan daftar produksi', () => {
  it('SET di atas, lalu jilid menaik', () => {
    const hasil = kelompokkanProduksi([
      baris({ produk: 'HADIST SOHIH BUKHORI DARUL HIKMAH PERJILID HARD COVER', varian: 'Jilid 6' }),
      baris({ produk: 'HADIST SOHIH BUKHORI DARUL HIKMAH SET 6 JILID, HARDCOVER.', varian: null }),
      baris({ produk: 'HADIST SOHIH BUKHORI DARUL HIKMAH PERJILID HARD COVER', varian: 'Jilid 1' }),
      baris({ produk: 'HADIST SOHIH BUKHORI DARUL HIKMAH PERJILID HARD COVER', varian: 'Jilid 3' }),
    ]);
    expect(hasil.grup.map((g) => g.nama)).toEqual([
      'Bukhori Set',
      'Bukhori Jilid 1',
      'Bukhori Jilid 3',
      'Bukhori Jilid 6',
    ]);
  });

  it('menjumlahkan unit per nama pendek', () => {
    const hasil = kelompokkanProduksi([
      baris({ orderId: 'a', qty: 2 }),
      baris({ orderId: 'b', qty: 3 }),
    ]);
    expect(hasil.grup[0]?.totalUnit).toBe(5);
    expect(hasil.totalUnit).toBe(5);
    expect(hasil.totalPesanan).toBe(2);
  });

  it('di dalam grup, batas kirim terdekat naik ke atas', () => {
    const hasil = kelompokkanProduksi([
      baris({ orderId: 'jauh', shipByAt: '2026-10-20T00:00:00.000Z' }),
      baris({ orderId: 'dekat', shipByAt: '2026-10-02T00:00:00.000Z' }),
    ]);
    expect(hasil.grup[0]?.pesanan.map((p) => p.orderId)).toEqual(['dekat', 'jauh']);
  });

  it('daftar kosong menghasilkan struktur kosong', () => {
    expect(kelompokkanProduksi([])).toEqual({ grup: [], totalPesanan: 0, totalUnit: 0 });
  });
});

describe('pembersihan teks untuk PDF', () => {
  it('membuang emoji dan menormalkan tanda baca', () => {
    expect(amanUntukPdf('Buku 📚 “Set” — Jilid’s')).toBe('Buku "Set" - Jilid\'s');
  });
});
