/**
 * Daftar produksi: pesanan yang barangnya belum ada di gudang.
 *
 * Dikelompokkan per SKU supaya tim produksi bisa kerja per batch (satu jilid
 * yang sama dikerjakan sekaligus), bukan per pesanan satu-satu.
 */

export interface BarisProduksi {
  orderId: string;
  externalOrderId: string;
  /** Tanggal pesanan masuk (ISO). */
  placedAt: string;
  /** Batas kirim (ISO) — dipakai tim produksi untuk urutan kerja. */
  shipByAt: string | null;
  sku: string;
  produk: string;
  varian: string | null;
  qty: number;
}

export interface GrupProduksi {
  sku: string;
  produk: string;
  varian: string | null;
  totalUnit: number;
  pesanan: BarisProduksi[];
}

export interface DaftarProduksi {
  grup: GrupProduksi[];
  totalPesanan: number;
  totalUnit: number;
}

/** Mengelompokkan baris per SKU; urutan grup mengikuti SKU terkecil agar stabil. */
export function kelompokkanProduksi(rows: readonly BarisProduksi[]): DaftarProduksi {
  const peta = new Map<string, GrupProduksi>();
  for (const r of rows) {
    const ada = peta.get(r.sku);
    if (ada) {
      ada.pesanan.push(r);
      ada.totalUnit += r.qty;
    } else {
      peta.set(r.sku, {
        sku: r.sku,
        produk: r.produk,
        varian: r.varian,
        totalUnit: r.qty,
        pesanan: [r],
      });
    }
  }

  const grup = [...peta.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  for (const g of grup) {
    g.pesanan.sort((a, b) => {
      const aShip = a.shipByAt ? new Date(a.shipByAt).getTime() : Number.POSITIVE_INFINITY;
      const bShip = b.shipByAt ? new Date(b.shipByAt).getTime() : Number.POSITIVE_INFINITY;
      return aShip - bShip;
    });
  }

  return {
    grup,
    totalPesanan: new Set(rows.map((r) => r.orderId)).size,
    totalUnit: rows.reduce((n, r) => n + r.qty, 0),
  };
}

/**
 * Huruf standar PDF (Helvetica) hanya mendukung Latin-1. Nama produk Shopee
 * sering memuat karakter di luar itu (emoji, tanda kutip melengkung). Tanpa
 * pembersihan, `pdf-lib` melempar error dan PDF gagal dibuat — jadi teks
 * dinormalisasi, bukan dibiarkan menggagalkan seluruh dokumen.
 */
export function amanUntukPdf(teks: string): string {
  return teks
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E\n]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
