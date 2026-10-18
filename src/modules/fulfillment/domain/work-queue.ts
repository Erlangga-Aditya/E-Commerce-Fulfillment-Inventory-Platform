/**
 * Antrean kerja gudang — definisi TUNGGAL untuk kartu ringkasan halaman Pesanan
 * dan untuk badge angka di menu samping.
 *
 * Sebelumnya keduanya dihitung dengan rumus berbeda: kartu memakai "tahap kerja
 * gudang" (31 pesanan) sementara badge memakai "pesanan CONFIRMED yang belum
 * punya fulfillment selesai" (68 pesanan). Dua angka berbeda untuk hal yang
 * sama persis membingungkan operator — dan badge-nya yang salah.
 */
import { resolveOperatorStage, type OperatorStage } from './operator-workflow';

/** Tahap yang berarti pesanan MASIH menunggu pekerjaan gudang. */
export const WORK_STAGES: readonly OperatorStage[] = [
  'BARU',
  'MENUNGGU_STOK',
  'SIAP_DIKEMAS',
  'SIAP_KIRIM',
] as const;

export interface WorkQueueInput {
  orderStatus: string;
  fulfillmentStatus: string | null;
  shipmentStatus: string | null;
  hasAwb: boolean;
}

export interface WorkQueueEntry {
  stage: OperatorStage;
  /** true = masih perlu dikerjakan gudang (belum diserahkan / belum diterima pembeli / bukan batal). */
  needsWork: boolean;
  hasAwb: boolean;
}

export function classifyWorkQueue(input: WorkQueueInput): WorkQueueEntry {
  const stage = resolveOperatorStage({
    orderStatus: input.orderStatus,
    fulfillmentStatus: input.fulfillmentStatus,
    shipmentStatus: input.shipmentStatus,
  });
  return { stage, needsWork: WORK_STAGES.includes(stage), hasAwb: input.hasAwb };
}

/** Kartu/penyaring yang dipakai halaman Pesanan. */
export type QueueBucket = 'semua' | 'baru' | 'sudahResi' | 'perluDiproses';

export const QUEUE_BUCKETS: readonly QueueBucket[] = ['semua', 'baru', 'sudahResi', 'perluDiproses'] as const;

export function isQueueBucket(value: string | null | undefined): value is QueueBucket {
  return typeof value === 'string' && (QUEUE_BUCKETS as readonly string[]).includes(value);
}

/**
 * Satu pesanan masuk ke kartu mana.
 *
 *  - `perluDiproses` : SEMUA yang masih menunggu pekerjaan gudang
 *                      (= `baru` + `sudahResi`, jadi angkanya selalu konsisten)
 *  - `baru`          : belum punya nomor resi
 *  - `sudahResi`     : sudah punya nomor resi, belum diserahkan ke kurir
 *  - `semua`         : tanpa penyaringan
 */
export function belongsToBucket(bucket: QueueBucket, entry: WorkQueueEntry): boolean {
  if (!entry.needsWork) return false;
  if (bucket === 'semua') return true;
  if (bucket === 'perluDiproses') return true;
  if (bucket === 'baru') return !entry.hasAwb;
  return entry.hasAwb;
}

export interface QueueCounts {
  perluDiproses: number;
  pesananBaru: number;
  sudahResi: number;
}

export function countBuckets(entries: WorkQueueEntry[]): QueueCounts {
  let pesananBaru = 0;
  let sudahResi = 0;
  for (const entry of entries) {
    if (!entry.needsWork) continue;
    if (entry.hasAwb) sudahResi += 1;
    else pesananBaru += 1;
  }
  return { perluDiproses: pesananBaru + sudahResi, pesananBaru, sudahResi };
}
