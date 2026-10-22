import { prisma } from '@/shared/infrastructure/prisma';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { BusinessRuleViolationError, NotFoundError } from '@/shared/errors/AppError';
import { logger } from '@/shared/observability/logger';
import { susunSaran, validasiSeleksi, type SaranPilihan } from '../domain/owner-selection';
import { processOrderForFulfillment } from './fulfillment.usecase';

/** Lama penundaan bawaan: 6 jam. Cukup untuk menunggu bahan, tidak sampai lupa. */
export const JAM_TUNDA = 6;

/** Status mentah Shopee yang masih menunggu pekerjaan gudang. */
const STATUS_KERJA = ['READY_TO_SHIP', 'PROCESSED', 'RETRY_SHIP'];

/**
 * Saran urutan kerja untuk owner.
 *
 * Hanya pesanan yang benar-benar bisa dikerjakan (CONFIRMED + status mentah
 * menunggu kirim), dan mengecualikan yang sedang ditunda.
 */
export async function getSaranKerja(
  tenantId: string,
  now: Date = new Date(),
  limit = 12,
): Promise<SaranPilihan[]> {
  const kandidat = await prisma.order.findMany({
    where: {
      tenantId,
      status: 'CONFIRMED',
      externalStatus: { in: STATUS_KERJA },
      OR: [{ deferredUntil: null }, { deferredUntil: { lte: now } }],
    },
    select: { id: true, externalOrderId: true, placedAt: true, shipByAt: true },
    orderBy: { placedAt: 'asc' },
    take: 300,
  });

  return susunSaran(
    kandidat.map((k) => ({
      orderId: k.id,
      externalOrderId: k.externalOrderId,
      placedAt: k.placedAt.toISOString(),
      shipByAt: k.shipByAt ? k.shipByAt.toISOString() : null,
    })),
    now,
  ).slice(0, limit);
}

export interface HasilSeleksi {
  aksi: 'KERJAKAN' | 'TUNDA';
  diproses: number;
  gagal: { orderId: string; alasan: string }[];
  ditundaSampai?: string;
}

/**
 * Menerapkan pilihan owner: KERJAKAN (buat pekerjaan gudang) atau TUNDA.
 *
 * Kegagalan per pesanan dikumpulkan, bukan menggagalkan semuanya — satu pesanan
 * bermasalah tidak boleh membatalkan 49 pesanan lain yang sudah dipilih.
 */
export async function terapkanSeleksi(
  tenantId: string,
  actorId: string,
  input: { orderIds: string[]; aksi: string; alasan?: string | null },
  now: Date = new Date(),
): Promise<HasilSeleksi> {
  const cek = validasiSeleksi(input);
  if (!cek.ok) throw new BusinessRuleViolationError(cek.message);
  const aksi = input.aksi as 'KERJAKAN' | 'TUNDA';

  const pesanan = await prisma.order.findMany({
    where: { tenantId, id: { in: input.orderIds } },
    select: { id: true, externalOrderId: true, status: true },
  });
  const ditemukan = new Set(pesanan.map((p) => p.id));
  const hilang = input.orderIds.filter((id) => !ditemukan.has(id));
  if (hilang.length === input.orderIds.length) throw new NotFoundError('Pesanan', input.orderIds.join(','));

  if (aksi === 'TUNDA') {
    const sampai = new Date(now.getTime() + JAM_TUNDA * 3_600_000);
    await prisma.order.updateMany({
      where: { tenantId, id: { in: [...ditemukan] } },
      data: {
        deferredUntil: sampai,
        deferReason: (input.alasan ?? '').trim(),
        deferredById: actorId,
      },
    });
    await auditLog({
      tenantId,
      actorId,
      action: 'orders_deferred',
      entityType: 'Order',
      entityId: pesanan[0]?.id ?? 'banyak',
      metadata: { jumlah: ditemukan.size, sampai: sampai.toISOString(), alasan: input.alasan },
    });
    return { aksi, diproses: ditemukan.size, gagal: [], ditundaSampai: sampai.toISOString() };
  }

  // KERJAKAN: butuh gudang. Pakai gudang pertama tenant (satu gudang pada
  // praktiknya); pesanan tanpa gudang dilaporkan gagal, bukan dilewati diam-diam.
  const gudang = await prisma.warehouse.findFirst({
    where: { tenantId },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!gudang) throw new BusinessRuleViolationError('Belum ada gudang. Tambahkan gudang dulu.');

  const gagal: { orderId: string; alasan: string }[] = [];
  let diproses = 0;

  for (const p of pesanan) {
    try {
      await prisma.order.update({
        where: { id: p.id },
        data: { deferredUntil: null, deferReason: null, deferredById: null },
      });
      const hasil = await processOrderForFulfillment(tenantId, p.id, gudang.id, actorId);
      if (hasil.success) diproses += 1;
      else gagal.push({ orderId: p.id, alasan: `Stok kurang: ${hasil.failedSkus.join(', ')}` });
    } catch (err) {
      gagal.push({ orderId: p.id, alasan: (err as Error).message });
      logger.warn(`Pilih-kerja gagal untuk ${p.externalOrderId}: ${(err as Error).message}`);
    }
  }

  await auditLog({
    tenantId,
    actorId,
    action: 'orders_selected_for_work',
    entityType: 'Order',
    entityId: pesanan[0]?.id ?? 'banyak',
    metadata: { jumlah: diproses, gagal: gagal.length },
  });

  return { aksi, diproses, gagal };
}
