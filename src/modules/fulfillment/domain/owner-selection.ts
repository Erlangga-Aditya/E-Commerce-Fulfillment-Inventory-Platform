/**
 * Aturan pemilihan pesanan oleh owner.
 *
 * Kenapa ada: pesanan masuk terus, tetapi owner yang memutuskan mana yang
 * dikerjakan lebih dulu. Urutan TIDAK dikarang UI — domain ini yang menentukan,
 * supaya saran di layar dan urutan kerja nyata selalu sama.
 *
 * Dasar urutan (dari yang paling mendesak):
 *  1. batas kirim (ship-by) paling dekat — inilah yang menentukan paket
 *     dibatalkan sistem atau tidak;
 *  2. pesanan tanpa batas kirim ditaruh paling belakang;
 *  3. bila batas kirim sama, pesanan yang masuk lebih dulu didahulukan.
 */

export interface KandidatPilihan {
  orderId: string;
  externalOrderId: string;
  placedAt: string;
  shipByAt: string | null;
}

export interface SaranPilihan extends KandidatPilihan {
  /** Penjelasan singkat, ditampilkan apa adanya di layar. */
  alasan: string;
  /** Sisa jam menuju batas kirim (negatif = sudah lewat). */
  sisaJam: number | null;
}

/** Batas jumlah pesanan sekali proses — menjaga satu klik tidak membebani server. */
export const MAKS_PILIHAN = 50;

/** Alasan menunda minimal 8 karakter, supaya catatan benar-benar berguna. */
export const MIN_ALASAN_TUNDA = 8;

export function susunSaran(kandidat: readonly KandidatPilihan[], now: Date): SaranPilihan[] {
  const denganSisa = kandidat.map((k) => {
    const ship = k.shipByAt ? new Date(k.shipByAt).getTime() : null;
    return { ...k, sisaJam: ship === null ? null : Math.round((ship - now.getTime()) / 3_600_000) };
  });

  denganSisa.sort((a, b) => {
    const aShip = a.shipByAt ? new Date(a.shipByAt).getTime() : Number.POSITIVE_INFINITY;
    const bShip = b.shipByAt ? new Date(b.shipByAt).getTime() : Number.POSITIVE_INFINITY;
    if (aShip !== bShip) return aShip - bShip;
    return new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime();
  });

  return denganSisa.map((k) => ({
    ...k,
    alasan:
      k.sisaJam === null
        ? 'Tanpa batas kirim'
        : k.sisaJam < 0
          ? `Terlambat ${Math.abs(k.sisaJam)} jam`
          : k.sisaJam <= 24
            ? `Tersisa ${k.sisaJam} jam`
            : `Tersisa ${Math.floor(k.sisaJam / 24)} hari`,
  }));
}

export type AksiSeleksi = 'KERJAKAN' | 'TUNDA';

export type HasilValidasiSeleksi =
  | { ok: true }
  | { ok: false; message: string };

export function validasiSeleksi(input: {
  orderIds: readonly string[];
  aksi: string;
  alasan?: string | null;
}): HasilValidasiSeleksi {
  if (input.aksi !== 'KERJAKAN' && input.aksi !== 'TUNDA') {
    return { ok: false, message: 'Aksi harus KERJAKAN atau TUNDA.' };
  }
  if (input.orderIds.length === 0) {
    return { ok: false, message: 'Pilih minimal satu pesanan.' };
  }
  if (input.orderIds.length > MAKS_PILIHAN) {
    return { ok: false, message: `Maksimal ${MAKS_PILIHAN} pesanan sekali proses.` };
  }
  if (new Set(input.orderIds).size !== input.orderIds.length) {
    return { ok: false, message: 'Ada pesanan yang terpilih lebih dari sekali.' };
  }
  if (input.aksi === 'TUNDA' && (input.alasan ?? '').trim().length < MIN_ALASAN_TUNDA) {
    return {
      ok: false,
      message: `Alasan menunda wajib diisi minimal ${MIN_ALASAN_TUNDA} karakter.`,
    };
  }
  return { ok: true };
}
