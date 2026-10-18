import { describe, expect, it } from 'vitest';
import { belongsToBucket, classifyWorkQueue, countBuckets, type WorkQueueEntry } from './work-queue';

const entry = (over: Partial<Parameters<typeof classifyWorkQueue>[0]> = {}): WorkQueueEntry =>
  classifyWorkQueue({
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: null,
    shipmentStatus: null,
    hasAwb: false,
    ...over,
  });

describe('antrean kerja gudang', () => {
  it('pesanan baru tanpa fulfillment masih perlu dikerjakan', () => {
    expect(entry()).toMatchObject({ stage: 'BARU', needsWork: true, hasAwb: false });
  });

  it('menunggu stok masih perlu dikerjakan', () => {
    expect(entry({ fulfillmentStatus: 'WAITING_STOCK' })).toMatchObject({
      stage: 'MENUNGGU_STOK',
      needsWork: true,
    });
  });

  it('sudah dikemas & sudah ada resi masih perlu diserahkan ke kurir', () => {
    expect(entry({ fulfillmentStatus: 'READY_TO_SHIP', shipmentStatus: 'READY_TO_SHIP', hasAwb: true })).toMatchObject({
      stage: 'SIAP_KIRIM',
      needsWork: true,
    });
  });

  it.each(['PICKED_UP', 'IN_TRANSIT', 'DELIVERED'] as const)(
    'paket berstatus %s tidak lagi masuk antrean kerja',
    (status) => {
      expect(entry({ fulfillmentStatus: 'READY_TO_SHIP', shipmentStatus: status, hasAwb: true }).needsWork).toBe(false);
    },
  );

  it('pesanan batal dan selesai tidak pernah masuk antrean', () => {
    expect(entry({ orderStatus: 'CANCELLED' }).needsWork).toBe(false);
    expect(entry({ orderStatus: 'COMPLETED' }).needsWork).toBe(false);
  });

  it('fulfillment HANDED_OVER tidak masuk antrean walau resi belum tersinkron', () => {
    expect(entry({ fulfillmentStatus: 'HANDED_OVER', hasAwb: false }).needsWork).toBe(false);
  });

  it('kartu baru vs sudah resi membelah antrean tanpa sisa', () => {
    const daftar = [
      entry(),
      entry({ fulfillmentStatus: 'WAITING_STOCK' }),
      entry({ fulfillmentStatus: 'READY_TO_SHIP', shipmentStatus: 'READY_TO_SHIP', hasAwb: true }),
      entry({ orderStatus: 'CANCELLED' }),
    ];
    const baru = daftar.filter((e) => belongsToBucket('baru', e));
    const sudahResi = daftar.filter((e) => belongsToBucket('sudahResi', e));
    const perlu = daftar.filter((e) => belongsToBucket('perluDiproses', e));

    expect(baru).toHaveLength(2);
    expect(sudahResi).toHaveLength(1);
    // Invarian penting: Perlu Diproses = Pesanan Baru + Sudah Ada Resi.
    expect(perlu).toHaveLength(baru.length + sudahResi.length);
  });

  it('bucket "semua" dipakai hanya untuk melihat pesanan final', () => {
    expect(belongsToBucket('semua', entry({ orderStatus: 'CANCELLED' }))).toBe(false);
    expect(belongsToBucket('semua', entry())).toBe(true);
  });

  it('countBuckets menjumlahkan sesuai definisi kartu', () => {
    const entries = [
      entry(),
      entry(),
      entry({ hasAwb: true }),
      entry({ orderStatus: 'COMPLETED' }),
    ];
    expect(countBuckets(entries)).toEqual({ perluDiproses: 3, pesananBaru: 2, sudahResi: 1 });
  });
});
