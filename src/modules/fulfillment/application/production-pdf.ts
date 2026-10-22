import { prisma } from '@/shared/infrastructure/prisma';
import { hitungSisaWaktu } from '../domain/countdown';
import {
  amanUntukPdf,
  kelompokkanProduksi,
  namaPendek,
  rentangTanggal,
  type BarisProduksi,
  type DaftarProduksi,
} from '../domain/production-list';
import { classifyWorkQueue } from '../domain/work-queue';

export interface PesananMendesak {
  orderId: string;
  externalOrderId: string;
  /** Nama pendek produk (sama seperti di lembar produksi). */
  nama: string;
  qty: number;
  batasKirim: string;
  /** Mis. "Sisa 6 jam" / "Lewat 3 jam". */
  sisaTeks: string;
  nada: 'lewat' | 'kritis' | 'waspada' | 'aman';
  jam: number;
}

export interface DataProduksi extends DaftarProduksi {
  kodeBatch: string;
  dicetakPada: Date;
  /** 5 pesanan dengan batas kirim paling dekat (paling cepat dibatalkan Shopee). */
  mendesak: PesananMendesak[];
}

/**
 * Mengambil pesanan yang barangnya belum ada (pekerjaan gudang WAITING_STOCK).
 * `orderIds` opsional: dipakai saat owner memilih hanya sebagian pesanan.
 */
export async function ambilDataProduksi(
  tenantId: string,
  opsi: { orderIds?: string[]; limit?: number } = {},
): Promise<DataProduksi> {
  // ── Pemilihan pesanan: SATU SUMBER KEBENARAN dengan badge "Perlu Diproses".
  // Dulu daftar ini hanya mengambil fulfillment `WAITING_STOCK`, sehingga:
  //   (a) pesanan yang stoknya sudah ada (SIAP_DIKEMAS) tidak pernah masuk lembar
  //       produksi — padahal barangnya tetap harus dikerjakan gudang, dan
  //   (b) pesanan batal ikut terhitung bila baris fulfillment-nya belum ditutup.
  // Pemilihan kini memakai `classifyWorkQueue` yang sama dengan halaman Pesanan —
  // daftar produksi dan badge menu tidak bisa beda lagi.
  const kandidat = await prisma.order.findMany({
    where: {
      tenantId,
      status: { in: ['NEW', 'CONFIRMED'] },
      ...(opsi.orderIds && opsi.orderIds.length > 0 ? { id: { in: opsi.orderIds } } : {}),
    },
    select: {
      id: true,
      externalOrderId: true,
      status: true,
      externalStatus: true,
      placedAt: true,
      shipByAt: true,
      fulfillmentOrders: {
        where: { status: { notIn: ['COMPLETED'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true },
      },
      shipments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { awb: true, status: true },
      },
      items: {
        select: {
          quantity: true,
          variant: { select: { sku: true, name: true, product: { select: { name: true } } } },
        },
      },
    },
    orderBy: { placedAt: 'asc' },
    take: opsi.limit ?? 400,
  });

  const baris: BarisProduksi[] = [];
  for (const o of kandidat) {
    const fo = o.fulfillmentOrders[0] ?? null;
    const shipment = o.shipments[0] ?? null;
    const antrean = classifyWorkQueue({
      orderStatus: o.status,
      externalStatus: o.externalStatus,
      fulfillmentStatus: fo?.status ?? null,
      shipmentStatus: shipment?.status ?? null,
      hasAwb: Boolean(shipment?.awb?.trim()),
    });
    // Batal / sudah dijemput kurir / sudah diterima → bukan pekerjaan produksi.
    if (!antrean.needsWork) continue;

    for (const item of o.items) {
      baris.push({
        orderId: o.id,
        externalOrderId: o.externalOrderId,
        placedAt: o.placedAt.toISOString(),
        shipByAt: o.shipByAt ? o.shipByAt.toISOString() : null,
        sku: item.variant?.sku ?? '(tanpa SKU)',
        produk: item.variant?.product?.name ?? '(tanpa nama)',
        varian: item.variant?.name ?? null,
        qty: item.quantity,
      });
    }
  }

  const sekarang = new Date();

  // Satu baris per PESANAN (bukan per item) untuk hitung mundur: yang penting
  // "pesanan mana yang paling cepat dibatalkan", beserta total unitnya.
  const perPesanan = new Map<string, PesananMendesak>();
  for (const b of baris) {
    if (!b.shipByAt) continue;
    const sisa = hitungSisaWaktu(b.shipByAt, sekarang);
    if (!sisa) continue;
    const ada = perPesanan.get(b.orderId);
    if (ada) {
      ada.qty += b.qty;
    } else {
      perPesanan.set(b.orderId, {
        orderId: b.orderId,
        externalOrderId: b.externalOrderId,
        nama: namaPendek(b.produk, b.varian),
        qty: b.qty,
        batasKirim: b.shipByAt,
        sisaTeks: sisa.teks,
        nada: sisa.nada,
        jam: sisa.jam,
      });
    }
  }

  const mendesak = [...perPesanan.values()].sort((a, b) => a.jam - b.jam).slice(0, 5);

  return {
    ...kelompokkanProduksi(baris),
    kodeBatch: `PROD-${sekarang.toISOString().slice(0, 10).replace(/-/g, '')}`,
    dicetakPada: sekarang,
    mendesak,
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
