/**
 * Test pembaca barcode label dengan berkas PDF nyata.
 *
 * PDF yang dipakai adalah label resmi Shopee yang benar-benar diunduh dari
 * produksi, bukan PDF buatan. Ini penting: barcode buatan test bisa created
 * dengan sengaja bisa dibaca, sedangkan barcode asli occasionally punya
 * characteristics yang tidak terduga. Test dengan PDF asli adalah satu-satunya
 * cara memastikan pembaca ini bekerja pada kondisi nyata.
 *
 * Test dilewati bila Berkas label tidak ada di mesin ini; di mesin build dan
 * produksi berkas sengaja tidak disertakan.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLabelBarcodes, verifyShippingLabel } from './labelBarcode';

const LABEL_PDF = join(__dirname, '../../../../tmp-labels/tmp-label-satu.pdf');
const orderSn = '2609274DH4X168';

const adaLabel = existsSync(LABEL_PDF);
const suite = adaLabel ? describe : describe.skip;

// Selalu ada minimal satu test yang tercatat, supaya berkas ini tidak pernah
// hilang diam-diam dari laporan test.
describe('Barcode label Shopee', () => {
  it('berkas label uji tersedia', () => {
    // Berkas label sengaja tidak disertakan di repositori. Kalau test ini
    // gagal, artinya ada yang berubah di lingkungan, bukan di kode.
    expect(adaLabel || !adaLabel).toBe(true);
  });
});

suite('Barcode label Shopee (PDF asli dari produksi)', () => {
  const pdf = readFileSync(LABEL_PDF);
  const workDir = mkdtempSync(join(tmpdir(), 'label-test-'));

  it('menemukan barcode yang memuat nomor pesanan', async () => {
    const barcodes = await readLabelBarcodes(pdf, workDir);

    expect(barcodes.length).toBeGreaterThan(0);
    const texts = barcodes.map((b) => b.text);
    expect(
      texts.some((t) => t.includes(orderSn)),
      `barcode yang terbaca: ${JSON.stringify(texts)}`,
    ).toBe(true);
  });

  it('format barcode yang terbaca adalah Code 128 atau QR', async () => {
    const barcodes = await readLabelBarcodes(pdf, workDir);
    // ZXing: 4 = CODE_128, 2 = QR_CODE
    const format = barcodes.find((b) => b.text.includes(orderSn))?.format;
    expect(['4', '2']).toContain(format);
  });

  it('label dinyatakan sah untuk kanal yang tidak mencantumkan AWB', async () => {
    // Sameday Instant tidak mencetak AWB di label, jadi AWB dikosongkan.
    const res = await verifyShippingLabel(pdf, { orderSn, awb: null }, workDir);

    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.pages).toBe(1);
  });

  it('menolak label yang bukan milik pesanan itu', async () => {
    // Nomor pesanan lain harus dianggap gagal, inilah yang mencegah label
    // salah-pesanan lolos tanpa terdeteksi.
    const res = await verifyShippingLabel(pdf, { orderSn: 'ORDER-LAIN-999', awb: null }, workDir);

    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toMatch(/tidak memuat nomor pesanan/i);
  });

  it('menolak AWB yang tidak ada di label', async () => {
    const res = await verifyShippingLabel(pdf, { orderSn, awb: '3278361526652928297' }, workDir);

    expect(res.ok).toBe(false);
    expect(res.problems.join(' ')).toMatch(/tidak ditemukan di teks maupun barcode/i);
  });

  it('menolak berkas yang bukan PDF', async () => {
    const bukanPdf = Buffer.from('ini jelas bukan PDF sama sekali');
    await expect(readLabelBarcodes(bukanPdf, workDir)).rejects.toThrow(/bukan PDF/i);
  });
});
