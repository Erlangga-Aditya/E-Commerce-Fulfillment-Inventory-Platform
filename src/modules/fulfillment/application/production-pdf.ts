import { prisma } from '@/shared/infrastructure/prisma';
import {
  amanUntukPdf,
  kelompokkanProduksi,
  rentangTanggal,
  type BarisProduksi,
  type DaftarProduksi,
} from '../domain/production-list';

export interface DataProduksi extends DaftarProduksi {
  kodeBatch: string;
  dicetakPada: Date;
}

/**
 * Mengambil pesanan yang barangnya belum ada (pekerjaan gudang WAITING_STOCK).
 * `orderIds` opsional: dipakai saat owner memilih hanya sebagian pesanan.
 */
export async function ambilDataProduksi(
  tenantId: string,
  opsi: { orderIds?: string[]; limit?: number } = {},
): Promise<DataProduksi> {
  const fo = await prisma.fulfillmentOrder.findMany({
    where: {
      order: { tenantId },
      status: 'WAITING_STOCK',
      ...(opsi.orderIds && opsi.orderIds.length > 0 ? { orderId: { in: opsi.orderIds } } : {}),
    },
    select: {
      order: {
        select: {
          id: true,
          externalOrderId: true,
          placedAt: true,
          shipByAt: true,
          items: {
            select: {
              quantity: true,
              variant: { select: { sku: true, name: true, product: { select: { name: true } } } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: opsi.limit ?? 400,
  });

  const baris: BarisProduksi[] = [];
  for (const f of fo) {
    for (const item of f.order.items) {
      baris.push({
        orderId: f.order.id,
        externalOrderId: f.order.externalOrderId,
        placedAt: f.order.placedAt.toISOString(),
        shipByAt: f.order.shipByAt ? f.order.shipByAt.toISOString() : null,
        sku: item.variant?.sku ?? '(tanpa SKU)',
        produk: item.variant?.product?.name ?? '(tanpa nama)',
        varian: item.variant?.name ?? null,
        qty: item.quantity,
      });
    }
  }

  const sekarang = new Date();
  return {
    ...kelompokkanProduksi(baris),
    kodeBatch: `PROD-${sekarang.toISOString().slice(0, 10).replace(/-/g, '')}`,
    dicetakPada: sekarang,
  };
}

/**
 * PDF lembar kerja produksi — sengaja sederhana: **Produk · Qty · Tanggal**.
 * Nama panjang Shopee sudah diringkas oleh `namaPendek()`, dan urutannya
 * SET dulu lalu jilid (aturan tim produksi).
 */
export async function buatPdfProduksi(data: DataProduksi): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4: [number, number] = [595.28, 841.89];
  const margin = 40;
  const lebarIsi = A4[0] - margin * 2;
  let page = doc.addPage(A4);
  let y = A4[1] - margin;

  const tulis = (isi: string, x: number, size = 10, tebal = false, warna = rgb(0.1, 0.1, 0.1)) => {
    page.drawText(amanUntukPdf(isi), { x, y, size, font: tebal ? bold : font, color: warna });
  };
  const garis = (yGaris: number) =>
    page.drawLine({
      start: { x: margin, y: yGaris },
      end: { x: margin + lebarIsi, y: yGaris },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
    });
  const halamanBaru = () => {
    page = doc.addPage(A4);
    y = A4[1] - margin;
    tulis('Daftar Produksi (lanjutan)', margin, 10, true);
    y -= 16;
  };

  tulis('DAFTAR PRODUKSI', margin, 16, true);
  y -= 22;
  tulis(`Batch ${data.kodeBatch}`, margin, 10, true);
  tulis(`Dicetak ${data.dicetakPada.toLocaleString('id-ID')}`, margin + 260, 9);
  y -= 14;
  tulis(`${data.totalPesanan} pesanan · ${data.totalUnit} unit`, margin, 10);
  y -= 10;
  garis(y);
  y -= 18;

  // Kepala tabel: Produk · Qty · Tanggal
  tulis('Produk', margin, 9, true);
  tulis('Qty', margin + 330, 9, true);
  tulis('Tanggal', margin + 380, 9, true);
  y -= 11;
  garis(y);
  y -= 14;

  // SATU baris per produk: semua pesanan dengan produk yang sama digabung,
  // karena tim produksi membuat barangnya sekaligus — bukan per resi.
  for (const g of data.grup) {
    if (y < 100) halamanBaru();
    tulis(g.nama, margin, 9.5);
    if (g.pesanan.length > 1) {
      page.drawText(amanUntukPdf(`${g.pesanan.length} resi`), {
        x: margin,
        y: y - 9,
        size: 7.5,
        font,
        color: rgb(0.45, 0.45, 0.45),
      });
    }
    tulis(String(g.totalUnit), margin + 330, 9.5);
    tulis(rentangTanggal(g.pesanan), margin + 380, 9.5);
    y -= g.pesanan.length > 1 ? 20 : 13;
  }

  if (data.grup.length === 0) {
    tulis('Tidak ada pesanan yang menunggu produksi.', margin, 10);
    y -= 16;
  }

  if (y < 120) halamanBaru();
  y -= 12;
  garis(y);
  y -= 18;
  tulis('Diserahkan ke tim produksi:', margin, 9);
  tulis('Diterima tim produksi:', margin + 260, 9);
  y -= 34;
  tulis('(__________________________)', margin, 9);
  tulis('(__________________________)', margin + 260, 9);
  y -= 14;
  tulis('Tanggal: ____ / ____ / ______', margin, 8.5);
  tulis('Tanggal: ____ / ____ / ______', margin + 260, 8.5);

  return doc.save();
}
