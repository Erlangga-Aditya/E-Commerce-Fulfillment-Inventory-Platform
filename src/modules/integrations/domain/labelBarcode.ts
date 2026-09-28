/**
 * Pembaca barcode dari label PDF resmi Shopee.
 *
 * Alasan modul ini ada: barcode pada label Shopee adalah GAMBAR di dalam PDF,
 * bukan teks. Jadi untuk memastikan label benar-benar milik pesanan yang
 * sedang diproses, barcode harus dibaca dari gambar itu, bukan dicari di teks.
 * Pemeriksaan teks saja akan lolos untuk label yang salah Pesanan.
 *
 * Temuan lapangan yang membentuk aturan di sini:
 *
 * - Label Sameday Instant TIDAK memuat AWB. Yang tercetak adalah nomor
 *   pesanan (Code 128 dan QR), kode pengambilan, dan logo. Jadi "barcode
 *   PDF sama dengan AWB" tidak berlaku untuk semua kanal.
 * - Sebagian gambar besar di label ternyata logo, bukan barcode. Membacanya
 *   seperti barcode hanya membuang waktu; struktural lebih murah dicek dulu.
 *
 * Modul ini sengaja tidak memakai AI atau OCR. Barcode punya struktur biner
 * yang tegas; membacanya dengan dekoder barcode jauh lebih dapat diandalkan
 * daripada menebak dari gambar.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  BinaryBitmap,
  Code128Reader,
  Code39Reader,
  DataMatrixReader,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from '@zxing/library';
import { PNG } from 'pngjs';

/**
 * Bagian API ZXing yang dipakai. Ditulis eksplisit supaya jelas dan terperiksa,
 * dan supaya penambahan format baru harus disengaja.
 */
interface BarcodeReader {
  decode(image: BinaryBitmap): { getText(): string };
}

const execFileAsync = promisify(execFile);

// ── Tipe ─────────────────────────────────────────────────────────────────────

export interface LabelBarcode {
  page: number;
  /** Nama format barcode, mis. "CODE_128". Angka enum ZXing tidak dipakai
   *  karena nilainya mudah tertukar dan pernah menyebabkan decoder yang salah
   *  (MaxiCode) dipanggil. */
  format: string;
  text: string;
  width: number;
  height: number;
}

export interface LabelPageInfo {
  page: number;
  text: string;
  images: Array<{ xref: number; width: number; height: number }>;
}

export interface LabelVerification {
  /** true bila label tidak punya masalah yang bisa dibuktikan. */
  ok: boolean;
  problems: string[];
  notes: string[];
  barcodes: LabelBarcode[];
  pages: number;
}

// ── Batas aman ───────────────────────────────────────────────────────────────

/** Gambar lebih kecil dari ini tidak mungkin barcode yang berguna. */
const MIN_BARCODE_WIDTH = 120;
const MIN_BARCODE_HEIGHT = 40;

/** Batas ukuran PDF label, supaya satu label rakus tidak menghabiskan memori. */
const MAX_PDF_BYTES = 25 * 1024 * 1024;

/**
 * Format barcode yang dicoba, berurutan dari yang paling sering dipakai kurir.
 *
 * Sengaja memakai kelas reader satu per satu, BUKAN `MultiFormatReader`.
 * `MultiFormatReader` menyapu seluruh format yang dikenal ZXing, termasuk
 * MaxiCode, dan decoder MaxiCode di ZXing rekursi tanpa henti pada gambar yang
 * bukan MaxiCode. Akibatnya `RangeError: Maximum call stack size exceeded` -
 * proses yang memanggilnya mati, bukan sekadar gagal membaca.
 *
 * Bukti: label Shopee yang gambar logonya ikut diproses membuat test timeout
 * karena stack overflow di `maxicode/decoder/Decoder.correctErrors`.
 */
const BARCODE_READERS: ReadonlyArray<{ format: string; make: () => BarcodeReader }> = [
  { format: 'CODE_128', make: () => new Code128Reader() },
  { format: 'QR_CODE', make: () => new QRCodeReader() },
  { format: 'DATA_MATRIX', make: () => new DataMatrixReader() },
  { format: 'CODE_39', make: () => new Code39Reader() },
];

// ── Bantu ────────────────────────────────────────────────────────────────────

function parseJsonOutput<T>(stdout: string, what: string): T {
  // PyMuPDF bisa mencetak peringatan ke stdout, dan JSON skrip read-label-text
  // sengaja di-indent supaya mudah dibaca manusia. Jadi yang dicari bukan satu
  // baris, tapi objek JSON pertama yang utuh - dari '{' pertama sampai '}'
  // terakhir yang seimbang.
  const start = stdout.indexOf('{');
  if (start === -1) throw new Error(`Tidak bisa membaca hasil ${what}.`);

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < stdout.length; i += 1) {
    const ch = stdout[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(stdout.slice(start, i + 1)) as T;
    }
  }
  throw new Error(`Hasil ${what} tidak lengkap.`);
}

// ── Baca barcode ─────────────────────────────────────────────────────────────

/**
 * Baca semua barcode yang bisa ditemukan di dalam PDF label.
 *
 * Penyaringan gambar dilakukan lebih dulu: gambar kecil (ikon, logo kecil)
 * dilewati karena mustahil berisi barcode yang bisa dipakai. Ini jauh lebih
 * murah daripada menjalankan dekoder pada setiap gambar.
 */
export async function readLabelBarcodes(pdf: Buffer, workDir: string): Promise<LabelBarcode[]> {
  if (pdf.byteLength > MAX_PDF_BYTES) {
    throw new Error(`Label terlalu besar (${pdf.byteLength} byte).`);
  }
  if (pdf.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error('Berkas label bukan PDF.');
  }

  const pdfPath = `${workDir}/label.pdf`;
  await mkdir(workDir, { recursive: true });
  await writeFile(pdfPath, pdf);

  const raw = await execFileAsync('uv', ['run', '--with', 'pymupdf', 'python', pythonScript('extract-label-images.py'), pdfPath], {
    maxBuffer: 32 * 1024 * 1024,
  });
  const { images } = parseJsonOutput<{ images: Array<{ page: number; path: string; width: number; height: number }> }>(
    raw.stdout,
    'daftar gambar label',
  );

  const found: LabelBarcode[] = [];
  for (const meta of images) {
    if (meta.width < MIN_BARCODE_WIDTH || meta.height < MIN_BARCODE_HEIGHT) continue;
    if (!existsSync(meta.path)) continue;

    let png;
    try {
      png = PNG.sync.read(readFileSync(meta.path));
    } catch {
      continue;
    }

    const lum = new Uint8ClampedArray(png.width * png.height);
    for (let i = 0, p = 0; i < lum.length; i += 1, p += 4) lum[i] = png.data[p] ?? 255;

    // Format diuji satu per satu memakai reader khusus. MultiFormatReader
    // tidak dipakai karena ia menyapu semua format yang dikenal ZXing,
    // termasuk MaxiCode, dan decoder MaxiCode rekursi sampai stack overflow
    // pada gambar yang bukan MaxiCode - prosesnya mati, bukan cuma gagal.
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, png.width, png.height)));
    for (const { format, make } of BARCODE_READERS) {
      try {
        const res = make().decode(bitmap);
        found.push({
          page: meta.page,
          format,
          text: res.getText(),
          width: meta.width,
          height: meta.height,
        });
        break;
      } catch {
        // bukan format ini; coba berikutnya
      }
    }
  }
  return found;
}

/** Teks label per halaman. */
export async function readLabelText(pdf: Buffer, workDir: string): Promise<LabelPageInfo[]> {
  const pdfPath = `${workDir}/label-text.pdf`;
  await mkdir(workDir, { recursive: true });
  await writeFile(pdfPath, pdf);

  const raw = await execFileAsync('uv', ['run', '--with', 'pymupdf', 'python', pythonScript('read-label-text.py'), pdfPath], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return parseJsonOutput<{ pages: LabelPageInfo[] }>(raw.stdout, 'teks label').pages;
}

// ── Verifikasi ───────────────────────────────────────────────────────────────

/**
 * Periksa satu label PDF.
 *
 * Yang dipastikan:
 * 1. Barcode yang terbaca milik pesanan yang sedang dicetak. Inilah
 *    pemeriksaan yang menangkap label salah-pesanan.
 * 2. Kalau kanal memang mencetak AWB, resi itu harus ada di label, entah
 *    sebagai teks atau sebagai barcode.
 *
 * `awb` boleh null untuk kanal yang tidak mencantumkan resi di label.
 */
export async function verifyShippingLabel(
  pdf: Buffer,
  expected: { orderSn: string; awb?: string | null },
  workDir: string,
): Promise<LabelVerification> {
  const problems: string[] = [];
  const notes: string[] = [];

  const barcodes = await readLabelBarcodes(pdf, workDir);
  const pages = await readLabelText(pdf, workDir);
  const texts = barcodes.map((b) => b.text);

  const orderMatched = texts.some((t) => t.includes(expected.orderSn));
  if (!orderMatched) {
    problems.push(
      `Barcode label tidak memuat nomor pesanan ${expected.orderSn}. ` +
        `Yang terbaca: ${JSON.stringify(texts)}`,
    );
  } else {
    notes.push(`barcode label memuat nomor pesanan (${barcodes.length} barcode terbaca)`);
  }

  const awb = expected.awb;
  if (awb) {
    const allText = pages.map((p) => p.text).join('').replace(/\s+/g, '');
    if (allText.includes(awb)) {
      notes.push(`resi ${awb} tercetak sebagai teks di label`);
    } else if (texts.some((t) => t.includes(awb))) {
      notes.push(`resi ${awb} ada di barcode label`);
    } else {
      problems.push(`Resi ${awb} tidak ditemukan di teks maupun barcode label.`);
    }
  } else {
    notes.push('kanal ini tidak mencantumkan AWB di label, jadi resi tidak diperiksa di sini');
  }

  return { ok: problems.length === 0, problems, notes, barcodes, pages: pages.length };
}

// ── Lokasi skrip Python ──────────────────────────────────────────────────────

/**
 * Skrip Python diletakkan di sebelah modul ini, bukan di skrip sementara.
 *
 * Label PDF adalah binary; membacanya dari Node butuh pustaka gambar. Dua
 * skrip kecil di `scripts/` menjalankan PyMuPDF lewat `uv` supaya aplikasi
 * tidak perlu memasang apa pun dan tidak perlu tahu detail format PDF.
 */
function pythonScript(name: string): string {
  return fileURLToPath(new URL(`./scripts/${name}`, import.meta.url));
}
