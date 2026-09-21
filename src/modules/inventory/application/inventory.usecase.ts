import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import { calculateAvailable } from '../domain/inventory.entity';
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

  // Atomic: upsert balance + create movement
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

    await tx.inventoryMovement.create({
      data: {
        tenantId,
        warehouseId,
        variantId,
        movementType: 'RECEIVE',
        quantityDelta: quantity,
        referenceType: 'manual',
        reason: notes ?? 'Penerimaan stok',
        actorId,
      },
    });
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'stock_receive',
    entityType: 'InventoryBalance',
    entityId: `${warehouseId}:${variantId}`,
    metadata: { quantity, warehouseId, variantId },
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

    await tx.inventoryMovement.create({
      data: {
        tenantId,
        warehouseId,
        variantId,
        movementType: 'ADJUSTMENT',
        quantityDelta,
        referenceType: 'adjustment',
        reason: `${reason}${notes ? `: ${notes}` : ''}`,
        actorId,
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

    await tx.inventoryMovement.create({
      data: {
        tenantId,
        warehouseId,
        variantId,
        movementType: 'RESERVE',
        quantityDelta: -quantity, // reservation reduces available
        referenceType: 'order_item',
        referenceId: orderItemId,
        actorId,
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
        actorId,
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
