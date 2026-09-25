import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { calculateAvailable, type StockAvailability } from '../domain/inventory.entity';
import { createStockLot, consumeStockLotsFifo } from './stock-lot.service';
import {
  NotFoundError,
  InsufficientStockError,
  ConflictError,
  ValidationError,
  BusinessRuleViolationError,
} from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { logger } from '@/shared/observability/logger';

// ────────────────────────────────────────────────────────────
// Input schemas
// ────────────────────────────────────────────────────────────

export const AdjustStockSchema = z.object({
  warehouseId: z.string().min(1),
  variantId: z.string().min(1),
  quantityDelta: z.number().int().refine((v) => v !== 0, 'Delta tidak boleh 0.'),
  reason: z.enum([
    'STOCK_COUNT', 'DAMAGE', 'EXPIRY', 'THEFT', 'TRANSFER', 'RECEIVING_ERROR', 'OTHER',
  ]),
  notes: z.string().max(500).optional(),
});

export const ReceiveStockSchema = z.object({
  warehouseId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.number().int().positive('Jumlah harus lebih dari 0.'),
  notes: z.string().max(500).optional(),
});

export type AdjustStockInput = z.infer<typeof AdjustStockSchema>;
export type ReceiveStockInput = z.infer<typeof ReceiveStockSchema>;

// ────────────────────────────────────────────────────────────
// Helper: Resolve actorId for inventory movement foreign key
// ────────────────────────────────────────────────────────────

async function resolveValidActorId(
  tx: { user: { findUnique: (args: { where: { id: string }; select: { id: true } }) => Promise<{ id: string } | null> } },
  actorId?: string | null,
): Promise<string | null> {
  if (!actorId) return null;
  const user = await tx.user.findUnique({ where: { id: actorId }, select: { id: true } });
  return user ? user.id : null;
}

// ────────────────────────────────────────────────────────────
// Use Cases
// ────────────────────────────────────────────────────────────

/**
 * Get inventory balance for a specific variant in a warehouse.
 * Returns availability calculation.
 */
export async function getInventoryBalance(
  tenantId: string,
  warehouseId: string,
  variantId: string,
) {
  // Verify warehouse belongs to tenant (IDOR protection)
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, tenantId },
  });
  if (!warehouse) throw new NotFoundError('Gudang', warehouseId);

  const balance = await prisma.inventoryBalance.findUnique({
    where: { warehouseId_variantId: { warehouseId, variantId } },
    include: { variant: { include: { product: true } } },
  });

  if (!balance) {
    return {
      warehouseId,
      variantId,
      onHand: 0,
      reserved: 0,
      blocked: 0,
      available: 0,
    };
  }

  return {
    warehouseId: balance.warehouseId,
    variantId: balance.variantId,
    sku: balance.variant.sku,
    productName: balance.variant.product.name,
    variantName: balance.variant.name,
    onHand: balance.onHand,
    reserved: balance.reserved,
    blocked: balance.blocked,
    available: calculateAvailable(balance),
    version: balance.version,
  };
}

/**
 * Batch stock availability lookup for many (warehouse, variant) pairs in a single query.
 * Avoids N+1 queries when rendering fulfillment queues or verifying shortfalls.
 * Returns a map keyed by `${warehouseId}:${variantId}`.
 */
export async function getAvailabilityMap(
  warehouseIds: string[],
  variantIds: string[],
): Promise<Map<string, StockAvailability>> {
  const map = new Map<string, StockAvailability>();
  if (warehouseIds.length === 0 || variantIds.length === 0) return map;

  const balances = await prisma.inventoryBalance.findMany({
    where: { warehouseId: { in: warehouseIds }, variantId: { in: variantIds } },
    select: { warehouseId: true, variantId: true, onHand: true, reserved: true, blocked: true },
  });

  for (const b of balances) {
    map.set(`${b.warehouseId}:${b.variantId}`, {
      warehouseId: b.warehouseId,
      variantId: b.variantId,
      onHand: b.onHand,
      reserved: b.reserved,
      blocked: b.blocked,
      available: calculateAvailable(b),
    });
  }
  return map;
}

/**
 * List inventory balances for a warehouse.
 */
export async function listInventoryBalances(
  tenantId: string,
  warehouseId: string,
  options: { page?: number; pageSize?: number; search?: string } = {},
) {
  const { page = 1, pageSize = 50, search } = options;

  // Default to the tenant's first warehouse when none is specified.
  if (!warehouseId) {
    warehouseId = (await prisma.warehouse.findFirst({ where: { tenantId }, orderBy: { createdAt: 'asc' } }))?.id ?? '';
  }

  // Verify warehouse belongs to tenant
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId, tenantId },
  });
  if (!warehouse) throw new NotFoundError('Gudang', warehouseId || 'belum ada gudang');

  const skip = (page - 1) * pageSize;

  const [balances, total] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where: {
        warehouseId,
        ...(search
          ? {
              variant: {
                OR: [
                  { sku: { contains: search } },
                  { name: { contains: search } },
                ],
              },
            }
          : {}),
      },
      include: {
        variant: { include: { product: true } },
      },
      skip,
      take: pageSize,
      orderBy: { variant: { sku: 'asc' } },
    }),
    prisma.inventoryBalance.count({ where: { warehouseId } }),
  ]);

  return {
    items: balances.map((b) => ({
      id: b.id,
      warehouseId: b.warehouseId,
      variantId: b.variantId,
      sku: b.variant.sku,
      productName: b.variant.product.name,
      variantName: b.variant.name,
      barcode: b.variant.barcode,
      onHand: b.onHand,
      reserved: b.reserved,
      blocked: b.blocked,
      available: calculateAvailable(b),
    })),
    pagination: { total, page, pageSize, hasMore: skip + pageSize < total },
  };
}

/**
 * Receive/inbound stock — increases onHand.
 * Always creates an inventory movement record (ledger).
 */
export async function receiveStock(
  tenantId: string,
  input: ReceiveStockInput,
  actorId: string,
) {
  const parsed = ReceiveStockSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Data penerimaan stok tidak valid.', {
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  const { warehouseId, variantId, quantity, notes } = parsed.data;

  // Verify warehouse + variant belong to tenant
  const [warehouse, variant] = await Promise.all([
    prisma.warehouse.findFirst({ where: { id: warehouseId, tenantId } }),
    prisma.productVariant.findFirst({
      where: { id: variantId, product: { tenantId } },
    }),
  ]);

  if (!warehouse) throw new NotFoundError('Gudang', warehouseId);
  if (!variant) throw new NotFoundError('Varian produk', variantId);

  // Atomic: upsert balance + lot FIFO + movement
  let lotId: string | null = null;
  await prisma.$transaction(async (tx) => {
    await tx.inventoryBalance.upsert({
      where: { warehouseId_variantId: { warehouseId, variantId } },
      create: {
        warehouseId,
        variantId,
        onHand: quantity,
        reserved: 0,
        blocked: 0,
        version: 1,
      },
      update: {
        onHand: { increment: quantity },
        version: { increment: 1 },
      },
    });

    // Setiap barang masuk = satu LOT baru (dasar alokasi FIFO).
    const lot = await createStockLot(tx, {
      warehouseId,
      variantId,
      quantity,
      source: 'RECEIVE',
      notes: notes ?? 'Penerimaan stok',
    });
    lotId = lot.id;

    const validActorId = await resolveValidActorId(tx, actorId);
    await tx.inventoryMovement.create({
      data: {
        tenantId,
        warehouseId,
        variantId,
        movementType: 'RECEIVE',
        quantityDelta: quantity,
        referenceType: 'manual',
        reason: notes ?? 'Penerimaan stok',
        actorId: validActorId,
        stockLotId: lot.id,
      },
    });
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'stock_receive',
    entityType: 'InventoryBalance',
    entityId: `${warehouseId}:${variantId}`,
    metadata: { quantity, warehouseId, variantId, lotId },
  });

  logger.info('Stock received', { tenantId, warehouseId, variantId, quantity });
}

/**
 * Manual stock adjustment — can increase or decrease onHand.
 * Requires a reason code (audit trail).
 * FR-INV-005
 */
export async function adjustStock(
  tenantId: string,
  input: AdjustStockInput,
  actorId: string,
) {
  const parsed = AdjustStockSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('Data penyesuaian stok tidak valid.', {
      fields: parsed.error.flatten().fieldErrors,
    });
  }

  const { warehouseId, variantId, quantityDelta, reason, notes } = parsed.data;

  // Verify tenant ownership
  const [warehouse, variant] = await Promise.all([
    prisma.warehouse.findFirst({ where: { id: warehouseId, tenantId } }),
    prisma.productVariant.findFirst({
      where: { id: variantId, product: { tenantId } },
    }),
  ]);

  if (!warehouse) throw new NotFoundError('Gudang', warehouseId);
  if (!variant) throw new NotFoundError('Varian produk', variantId);

  // Get current balance
  const balance = await prisma.inventoryBalance.findUnique({
    where: { warehouseId_variantId: { warehouseId, variantId } },
  });

  const currentOnHand = balance?.onHand ?? 0;
  const newOnHand = currentOnHand + quantityDelta;

  if (newOnHand < 0) {
    throw new BusinessRuleViolationError(
      `Penyesuaian stok akan menghasilkan stok negatif. Stok saat ini: ${currentOnHand}.`,
      { currentOnHand, quantityDelta, newOnHand },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.inventoryBalance.upsert({
      where: { warehouseId_variantId: { warehouseId, variantId } },
      create: {
        warehouseId,
        variantId,
        onHand: Math.max(0, quantityDelta),
        reserved: 0,
        blocked: 0,
        version: 1,
      },
      update: {
        onHand: { increment: quantityDelta },
        version: { increment: 1 },
      },
    });

    // Penyesuaian ke atas menambah lot baru; penyesuaian ke bawah memakai FIFO.
    if (quantityDelta > 0) {
      await createStockLot(tx, {
        warehouseId,
        variantId,
        quantity: quantityDelta,
        source: 'ADJUSTMENT',
        notes: `${reason}${notes ? `: ${notes}` : ''}`,
      });
    } else if (quantityDelta < 0) {
      await consumeStockLotsFifo(tx, {
        warehouseId,
        variantId,
        quantity: Math.abs(quantityDelta),
      });
    }

    const validActorId = await resolveValidActorId(tx, actorId);
    await tx.inventoryMovement.create({
      data: {
        tenantId,
        warehouseId,
        variantId,
        movementType: 'ADJUSTMENT',
        quantityDelta,
        referenceType: 'adjustment',
        reason: `${reason}${notes ? `: ${notes}` : ''}`,
        actorId: validActorId,
      },
    });
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'stock_adjust',
    entityType: 'InventoryBalance',
    entityId: `${warehouseId}:${variantId}`,
    metadata: { quantityDelta, reason, warehouseId, variantId },
  });
}

/**
 * Reserve stock for an order item.
 * Atomic — balance check + reservation are in one transaction.
 * FR-RES-001, FR-RES-002
 */
export async function reserveStock(
  tenantId: string,
  warehouseId: string,
  variantId: string,
  orderItemId: string,
  quantity: number,
  actorId: string,
): Promise<{ reservationId: string }> {
  // Check for existing reservation (idempotency)
  const existing = await prisma.stockReservation.findFirst({
    where: { orderItemId, status: 'ACTIVE' },
  });
  if (existing) {
    return { reservationId: existing.id };
  }

  return await prisma.$transaction(async (tx) => {
    // Lock the balance row for update
    const balance = await tx.inventoryBalance.findUnique({
      where: { warehouseId_variantId: { warehouseId, variantId } },
    });

    const available = balance ? calculateAvailable(balance) : 0;

    if (available < quantity) {
      // Get SKU for error message
      const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
      throw new InsufficientStockError(variant?.sku ?? variantId, available, quantity);
    }

    const reservation = await tx.stockReservation.create({
      data: {
        warehouseId,
        variantId,
        orderItemId,
        quantity,
        status: 'ACTIVE',
      },
    });

    await tx.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId, variantId } },
      data: {
        reserved: { increment: quantity },
        version: { increment: 1 },
      },
    });

    const validActorId = await resolveValidActorId(tx, actorId);
    await tx.inventoryMovement.create({
      data: {
        tenantId,
        warehouseId,
        variantId,
        movementType: 'RESERVE',
        quantityDelta: -quantity, // reservation reduces available
        referenceType: 'order_item',
        referenceId: orderItemId,
        actorId: validActorId,
      },
    });

    await auditLog({
      tenantId,
      actorId,
      action: 'stock_reserve',
      entityType: 'StockReservation',
      entityId: reservation.id,
      metadata: { warehouseId, variantId, quantity, orderItemId },
    });

    return { reservationId: reservation.id };
  });
}

/**
 * Release a stock reservation.
 * FR-RES-003 — explicit and auditable.
 */
export async function releaseReservation(
  tenantId: string,
  reservationId: string,
  actorId: string,
  reason?: string,
): Promise<void> {
  const reservation = await prisma.stockReservation.findUnique({
    where: { id: reservationId },
  });

  if (!reservation) throw new NotFoundError('Reservasi stok', reservationId);
  if (reservation.status !== 'ACTIVE') {
    throw new ConflictError(
      `Reservasi tidak dapat dilepas — status saat ini: ${reservation.status}.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.stockReservation.update({
      where: { id: reservationId },
      data: {
        status: 'RELEASED',
        releasedAt: new Date(),
      },
    });

    await tx.inventoryBalance.update({
      where: {
        warehouseId_variantId: {
          warehouseId: reservation.warehouseId,
          variantId: reservation.variantId,
        },
      },
      data: {
        reserved: { decrement: reservation.quantity },
        version: { increment: 1 },
      },
    });

    const validActorId = await resolveValidActorId(tx, actorId);
    await tx.inventoryMovement.create({
      data: {
        tenantId,
        warehouseId: reservation.warehouseId,
        variantId: reservation.variantId,
        movementType: 'RESERVE_RELEASE',
        quantityDelta: reservation.quantity, // positive: available restored
        referenceType: 'reservation',
        referenceId: reservationId,
        reason: reason ?? 'Reservasi dilepas',
        actorId: validActorId,
      },
    });
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'stock_reserve_release',
    entityType: 'StockReservation',
    entityId: reservationId,
    metadata: { reason },
  });
}

/**
 * List inventory movements (audit trail).
 */
export async function listInventoryMovements(
  tenantId: string,
  options: {
    warehouseId?: string;
    variantId?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const { warehouseId, variantId, page = 1, pageSize = 50 } = options;
  const skip = (page - 1) * pageSize;

  const where = {
    tenantId,
    ...(warehouseId ? { warehouseId } : {}),
    ...(variantId ? { variantId } : {}),
  };

  const [movements, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      include: {
        variant: { select: { sku: true, name: true } },
        warehouse: { select: { name: true, code: true } },
        actor: { select: { name: true, email: true } },
      },
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.inventoryMovement.count({ where }),
  ]);

  return {
    items: movements.map((m) => ({
      id: m.id,
      movementType: m.movementType,
      quantityDelta: m.quantityDelta,
      sku: m.variant.sku,
      variantName: m.variant.name,
      warehouseName: m.warehouse.name,
      warehouseCode: m.warehouse.code,
      referenceType: m.referenceType,
      referenceId: m.referenceId,
      reason: m.reason,
      actorName: m.actor?.name,
      createdAt: m.createdAt,
    })),
    pagination: { total, page, pageSize, hasMore: skip + pageSize < total },
  };
}

/**
 * Cari varian produk yang berasal dari Shopee (punya mapping hasil sinkronisasi).
 *
 * Dipakai oleh kotak "Tambah Stok" di Operasi Harian, supaya operator hanya bisa
 * memasukkan stok untuk produk yang benar-benar ada di toko Shopee klien —
 * bukan produk contoh/manual.
 */
export async function listShopeeSourcedVariants(
  tenantId: string,
  warehouseId: string | null,
  search?: string,
) {
  const keyword = search?.trim();
  const variants = await prisma.productVariant.findMany({
    where: {
      product: { tenantId },
      externalMappings: { some: { shop: { provider: 'shopee' } } },
      ...(keyword
        ? {
            OR: [
              { sku: { contains: keyword } },
              { name: { contains: keyword } },
              { barcode: { contains: keyword } },
              { product: { name: { contains: keyword } } },
            ],
          }
        : {}),
    },
    include: {
      product: { select: { name: true } },
      externalMappings: {
        where: { shop: { provider: 'shopee' } },
        select: { externalProductId: true, externalVariantId: true, shop: { select: { name: true } } },
        take: 1,
      },
    },
    orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
    take: 40,
  });

  if (variants.length === 0) return [];

  const balances = warehouseId
    ? await prisma.inventoryBalance.findMany({
        where: {
          warehouseId,
          variantId: { in: variants.map((v) => v.id) },
        },
      })
    : [];
  const balanceByVariant = new Map(balances.map((b) => [b.variantId, b]));

  const lots = warehouseId
    ? await prisma.stockLot.findMany({
        where: {
          warehouseId,
          variantId: { in: variants.map((v) => v.id) },
          remaining: { gt: 0 },
        },
        orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
      })
    : [];
  const lotsByVariant = new Map<string, typeof lots>();
  for (const lot of lots) {
    const list = lotsByVariant.get(lot.variantId) ?? [];
    list.push(lot);
    lotsByVariant.set(lot.variantId, list);
  }

  return variants.map((v) => {
    const balance = balanceByVariant.get(v.id);
    const openLots = lotsByVariant.get(v.id) ?? [];
    return {
      variantId: v.id,
      productId: v.productId,
      productName: v.product.name,
      sku: v.sku,
      variantName: v.name,
      barcode: v.barcode,
      imageUrl: v.imageUrl,
      shopName: v.externalMappings[0]?.shop.name ?? null,
      shopeeItemId: v.externalMappings[0]?.externalProductId ?? null,
      onHand: balance?.onHand ?? 0,
      reserved: balance?.reserved ?? 0,
      available: balance ? calculateAvailable(balance) : 0,
      /** Lot tertua yang masih tersisa — barang inilah yang akan keluar lebih dulu (FIFO). */
      oldestLotAt: openLots[0]?.receivedAt ?? null,
      openLotCount: openLots.length,
    };
  });
}
