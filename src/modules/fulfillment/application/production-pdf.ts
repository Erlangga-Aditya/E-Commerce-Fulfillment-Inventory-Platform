import { prisma } from '@/shared/infrastructure/prisma';
import { amanUntukPdf, kelompokkanProduksi, type BarisProduksi } from '../domain/production-list';

export interface DataProduksi {
  grup: ReturnType<typeof kelompokkanProduksi>['grup'];
  totalPesanan: number;
  totalUnit: number;
  kodeBatch: string;
  dibuatOleh: string;
  dicetakPada: Date;
}

/** Mengambil pesanan yang barangnya belum ada (pekerjaan gudang WAITING_STOCK). */
export async function ambilDataProduksi(
  tenantId: string,
  opsi: { limit?: number } = {},
): Promise<DataProduksi> {
  const fo = await prisma.fulfillmentOrder.findMany({
    where: { order: { tenantId }, status: 'WAITING_STOCK' },
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
    take: opsi.limit ?? 200,
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

  const ringkas = kelompokkanProduksi(baris);
  const sekarang = new Date();
  return {
    ...ringkas,
    kodeBatch: `PROD-${sekarang.toISOString().slice(0, 10).replace(/-/g, '')}`,
    dibuatOleh: 'Owner',
    dicetakPada: sekarang,
  };
}

/**
 * Membuat PDF A4 daftar produksi: satu blok per SKU (total unit jelas), daftar
 * pesanan di dalamnya, dan kolom tanda tangan untuk tim produksi.
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

  const teks = (isi: string, x: number, size = 9, pakaiBold = false, warna = rgb(0.1, 0.1, 0.1)) => {
    page.drawText(amanUntukPdf(isi), { x, y, size, font: pakaiBold ? bold : font, color: warna });
  };

  const garis = (yGaris: number) => {
    page.drawLine({
      start: { x: margin, y: yGaris },
      end: { x: margin + lebarIsi, y: yGaris },
      thickness: 0.5,
      color: rgb(0.75, 0.75, 0.75),
    });
  };

  const halamanBaru = (lanjutan: boolean) => {
    page = doc.addPage(A4);
    y = A4[1] - margin;
    if (lanjutan) {
      teks('Daftar Produksi (lanjutan)', margin, 10, true);
      y -= 16;
    }
  };

  teks('DAFTAR PRODUKSI', margin, 16, true);
  y -= 22;
  teks(`Batch: ${data.kodeBatch}`, margin, 10, true);
  teks(`Dicetak: ${data.dicetakPada.toLocaleString('id-ID')}`, margin + 200, 10);
  y -= 14;
  teks(`Total pesanan: ${data.totalPesanan}   |   Total unit: ${data.totalUnit}`, margin, 10);
  y -= 8;
  garis(y);
  y -= 16;

  for (const g of data.grup) {
    if (y < 120) halamanBaru(true);
    teks(`${g.sku}  |  ${g.produk}${g.varian ? ` - ${g.varian}` : ''}`, margin, 10, true);
    y -= 12;
    teks(`Total unit: ${g.totalUnit}  (${g.pesanan.length} pesanan)`, margin, 9);
    y -= 12;
    teks('No. Pesanan', margin, 8.5, true);
    teks('Qty', margin + 150, 8.5, true);
    teks('Batas Kirim', margin + 185, 8.5, true);
    teks('Masuk', margin + 300, 8.5, true);
    y -= 10;
    garis(y);
    y -= 11;

    for (const p of g.pesanan) {
      if (y < 90) halamanBaru(true);
      const batas = p.shipByAt ? new Date(p.shipByAt).toLocaleDateString('id-ID') : '-';
      const masuk = new Date(p.placedAt).toLocaleDateString('id-ID');
      teks(p.externalOrderId, margin, 8.5);
      teks(String(p.qty), margin + 150, 8.5);
      teks(batas, margin + 185, 8.5);
      teks(masuk, margin + 300, 8.5);
      y -= 12;
    }
    y -= 8;
  }

  if (data.grup.length === 0) {
    teks('Tidak ada pesanan yang menunggu produksi.', margin, 10);
    y -= 16;
  }

  if (y < 120) halamanBaru(false);
  y -= 10;
  garis(y);
  y -= 16;
  teks('Diserahkan ke tim produksi oleh:', margin, 9);
  teks('Diterima tim produksi:', margin + 260, 9);
  y -= 34;
  teks('(__________________________)', margin, 9);
  teks('(__________________________)', margin + 260, 9);
  y -= 14;
  teks(data.dibuatOleh, margin, 8.5);
  teks('Tanggal: ____ / ____ / ______', margin + 260, 8.5);

  return doc.save();
}
