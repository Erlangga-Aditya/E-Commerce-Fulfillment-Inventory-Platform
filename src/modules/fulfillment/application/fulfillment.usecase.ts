import { Prisma, FulfillmentStatus } from '@prisma/client';
import { prisma } from '@/shared/infrastructure/prisma';
import {
  isValidFulfillmentTransition,
  type FulfillmentStatus as DomainFulfillmentStatus,
  type ScanResult,
} from '../domain/fulfillment.entity';
import {
  NotFoundError,
  InvalidStateTransitionError,
  BusinessRuleViolationError,
} from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { reserveStock } from '@/modules/inventory/application/inventory.usecase';
import { recalculateOrderPriority } from '@/modules/orders/application/order.usecase';
import { logger } from '@/shared/observability/logger';

function assertTransition(from: string, to: DomainFulfillmentStatus, entity = 'Fulfillment Order') {
  if (!isValidFulfillmentTransition(from as DomainFulfillmentStatus, to)) {
    throw new InvalidStateTransitionError(entity, from, to);
  }
}

/**
 * Reserve stock for a CONFIRMED order and create the fulfillment order.
 * Idempotent. If all items reserve → READY_TO_PICK, else WAITING_STOCK.
 * FR-RES-001/002, FR-FUL-001/002.
 */
export async function processOrderForFulfillment(
  tenantId: string,
  orderId: string,
  warehouseId: string,
  actorId: string,
): Promise<{ fulfillmentOrderId: string; success: boolean; failedSkus: string[] }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    include: { items: { include: { variant: { select: { sku: true } } } } },
  });
  if (!order) throw new NotFoundError('Pesanan', orderId);
  if (order.status !== 'CONFIRMED') {
    throw new BusinessRuleViolationError(
      `Hanya pesanan CONFIRMED yang dapat diproses. Status saat ini: ${order.status}.`,
    );
  }

  const existing = await prisma.fulfillmentOrder.findFirst({
    where: { orderId, status: { notIn: ['COMPLETED', 'EXCEPTION'] } },
  });
  if (existing) return { fulfillmentOrderId: existing.id, success: existing.status !== 'WAITING_STOCK', failedSkus: [] };

  // Reserve each item (idempotent per order item).
  const failedSkus: string[] = [];
  for (const item of order.items) {
    try {
      await reserveStock(tenantId, warehouseId, item.variantId, item.id, item.quantity, actorId);
    } catch {
      failedSkus.push(item.variant.sku);
    }
  }

  const status: FulfillmentStatus = failedSkus.length > 0 ? 'WAITING_STOCK' : 'READY_TO_PICK';

  const fo = await prisma.$transaction(async (tx) => {
    const fulfillmentOrder = await tx.fulfillmentOrder.create({
      data: { orderId, warehouseId, status },
    });
    if (status === 'READY_TO_PICK') {
      await tx.pickingTask.create({
        data: {
          fulfillmentOrderId: fulfillmentOrder.id,
          status: 'PENDING',
          items: {
            create: order.items.map((item) => ({
              variantId: item.variantId,
              expectedQuantity: item.quantity,
              pickedQuantity: 0,
            })),
          },
        },
      });
    }
    return fulfillmentOrder;
  });

  await recalculateOrderPriority(tenantId, orderId);

  await auditLog({
    tenantId,
    actorId,
    action: 'fulfillment_order_created',
    entityType: 'FulfillmentOrder',
    entityId: fo.id,
    metadata: { orderId, warehouseId, status, failedSkus },
  });

  return { fulfillmentOrderId: fo.id, success: failedSkus.length === 0, failedSkus };
}

/** Queue of actionable fulfillment work (FR-FUL-002). */
export async function getFulfillmentQueue(
  tenantId: string,
  options: { status?: DomainFulfillmentStatus; page?: number; pageSize?: number } = {},
) {
  const { status, page = 1, pageSize = 50 } = options;
  const skip = (page - 1) * pageSize;

  const where: Prisma.FulfillmentOrderWhereInput = {
    order: { tenantId },
    ...(status ? { status: status as FulfillmentStatus } : { status: { notIn: ['HANDED_OVER', 'COMPLETED'] } }),
  };

  const [tasks, total] = await Promise.all([
    prisma.fulfillmentOrder.findMany({
      where,
      include: {
        order: {
          select: {
            id: true,
            externalOrderId: true,
            status: true,
            shipByAt: true,
            priorityScore: true,
            priorityLevel: true,
            buyerName: true,
            shop: { select: { name: true, provider: true } },
          },
        },
        warehouse: { select: { name: true, code: true } },
        pickingTasks: {
          include: { items: { include: { variant: { select: { sku: true, name: true, barcode: true } } } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      skip,
      take: pageSize,
      orderBy: [{ order: { priorityScore: 'desc' } }, { order: { shipByAt: 'asc' } }],
    }),
    prisma.fulfillmentOrder.count({ where }),
  ]);

  return {
    items: tasks.map((fo) => ({
      id: fo.id,
      status: fo.status,
      warehouseName: fo.warehouse.name,
      order: {
        id: fo.order.id,
        externalOrderId: fo.order.externalOrderId,
        shopName: fo.order.shop.name,
        provider: fo.order.shop.provider,
        buyerName: fo.order.buyerName,
        shipByAt: fo.order.shipByAt,
        priorityScore: fo.order.priorityScore,
        priorityLevel: fo.order.priorityLevel,
      },
      pickingTasks: fo.pickingTasks.map((t) => ({
        id: t.id,
        status: t.status,
        items: t.items.map((i) => ({
          id: i.id,
          sku: i.variant.sku,
          variantName: i.variant.name,
          barcode: i.variant.barcode,
          expectedQuantity: i.expectedQuantity,
          pickedQuantity: i.pickedQuantity,
          isConfirmed: i.isConfirmed,
        })),
      })),
    })),
    pagination: { total, page, pageSize, hasMore: skip + pageSize < total },
  };
}

/** Start picking: READY_TO_PICK → PICKING. */
export async function startPicking(
  tenantId: string,
  fulfillmentOrderId: string,
  actorId: string,
): Promise<void> {
  const fo = await prisma.fulfillmentOrder.findFirst({
    where: { id: fulfillmentOrderId, order: { tenantId } },
    include: { pickingTasks: true },
  });
  if (!fo) throw new NotFoundError('Fulfillment order', fulfillmentOrderId);
  assertTransition(fo.status, 'PICKING');

  await prisma.$transaction(async (tx) => {
    await tx.fulfillmentOrder.update({
      where: { id: fulfillmentOrderId },
      data: { status: 'PICKING', startedAt: fo.startedAt ?? new Date() },
    });
    await tx.pickingTask.updateMany({
      where: { fulfillmentOrderId, status: 'PENDING' },
      data: { status: 'IN_PROGRESS', startedAt: new Date(), assignedToId: actorId },
    });
  });
}

/** Scan an item (barcode/SKU). Validates + increments picked qty (FR-FUL-003/004). */
export async function processScan(
  tenantId: string,
  taskId: string,
  scannedCode: string,
  quantity: number = 1,
): Promise<ScanResult> {
  const task = await prisma.pickingTask.findFirst({
    where: { id: taskId, fulfillmentOrder: { order: { tenantId } } },
    include: {
      items: { include: { variant: { select: { id: true, sku: true, name: true, barcode: true } } } },
      fulfillmentOrder: true,
    },
  });
  if (!task) throw new NotFoundError('Picking task', taskId);

  if (task.status === 'COMPLETED') {
    return { success: false, error: { code: 'ALREADY_CONFIRMED', message: 'Picking task ini sudah selesai.' } };
  }

  const matchedItem = task.items.find(
    (item) => item.variant.sku === scannedCode || (item.variant.barcode && item.variant.barcode === scannedCode),
  );

  if (!matchedItem) {
    const isKnownSku = await prisma.productVariant.findFirst({
      where: { OR: [{ sku: scannedCode }, { barcode: scannedCode }], product: { tenantId } },
    });
    return {
      success: false,
      error: isKnownSku
        ? { code: 'SKU_MISMATCH', message: `SKU ${scannedCode} tidak termasuk dalam pesanan ini.`, expectedSku: task.items.map((i) => i.variant.sku).join(', ') }
        : { code: 'SKU_NOT_FOUND', message: `Kode ${scannedCode} tidak ditemukan dalam sistem.` },
    };
  }

  if (matchedItem.isConfirmed) {
    return { success: false, error: { code: 'ALREADY_CONFIRMED', message: `Item ${matchedItem.variant.sku} sudah dikonfirmasi.` } };
  }

  const newPickedQuantity = matchedItem.pickedQuantity + quantity;
  if (newPickedQuantity > matchedItem.expectedQuantity) {
    return {
      success: false,
      error: {
        code: 'QUANTITY_EXCEEDED',
        message: `Jumlah melebihi kebutuhan. Diperlukan: ${matchedItem.expectedQuantity}, dipindai: ${newPickedQuantity}.`,
        max: matchedItem.expectedQuantity,
      },
    };
  }

  const isNowConfirmed = newPickedQuantity >= matchedItem.expectedQuantity;
  await prisma.pickingItem.update({
    where: { id: matchedItem.id },
    data: { pickedQuantity: newPickedQuantity, isConfirmed: isNowConfirmed, scannedAt: new Date() },
  });

  const updatedItems = await prisma.pickingItem.findMany({ where: { pickingTaskId: taskId } });
  const allConfirmed = updatedItems.every((i) => i.isConfirmed);

  if (allConfirmed) {
    await prisma.$transaction(async (tx) => {
      await tx.pickingTask.update({
        where: { id: taskId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (task.fulfillmentOrder.status === 'PICKING') {
        await tx.fulfillmentOrder.update({ where: { id: task.fulfillmentOrderId }, data: { status: 'PICKED' } });
      }
    });
  }

  return {
    success: true,
    item: {
      pickingItemId: matchedItem.id,
      sku: matchedItem.variant.sku,
      variantName: matchedItem.variant.name,
      expectedQuantity: matchedItem.expectedQuantity,
      pickedQuantity: newPickedQuantity,
      isConfirmed: isNowConfirmed,
    },
    allConfirmed,
  };
}

/** Complete packing: PICKED → PACKED (FR-FUL-005). */
export async function completePacking(
  tenantId: string,
  fulfillmentOrderId: string,
  actorId: string,
  notes?: string,
): Promise<void> {
  const fo = await prisma.fulfillmentOrder.findFirst({
    where: { id: fulfillmentOrderId, order: { tenantId } },
    include: { pickingTasks: { include: { items: true } } },
  });
  if (!fo) throw new NotFoundError('Fulfillment order', fulfillmentOrderId);

  const allItems = fo.pickingTasks.flatMap((t) => t.items);
  const unconfirmed = allItems.filter((i) => !i.isConfirmed);
  if (unconfirmed.length > 0) {
    throw new BusinessRuleViolationError(
      `${unconfirmed.length} item belum dikonfirmasi. Selesaikan picking terlebih dahulu.`,
      { unconfirmedCount: unconfirmed.length },
    );
  }
  assertTransition(fo.status, 'PACKED');

  await prisma.$transaction(async (tx) => {
    await tx.fulfillmentOrder.update({ where: { id: fulfillmentOrderId }, data: { status: 'PACKED' } });
    await tx.packingTask.create({
      data: { fulfillmentOrderId, status: 'COMPLETED', packedById: actorId, packedAt: new Date(), notes },
    });
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'packing_complete',
    entityType: 'FulfillmentOrder',
    entityId: fulfillmentOrderId,
    metadata: { notes },
  });
}

/** Mark READY_TO_SHIP (internal fulfillment complete) — FR-FUL-006. */
export async function markReadyToShip(
  tenantId: string,
  fulfillmentOrderId: string,
  actorId: string,
): Promise<void> {
  const fo = await prisma.fulfillmentOrder.findFirst({
    where: { id: fulfillmentOrderId, order: { tenantId } },
  });
  if (!fo) throw new NotFoundError('Fulfillment order', fulfillmentOrderId);
  assertTransition(fo.status, 'READY_TO_SHIP');

  await prisma.fulfillmentOrder.update({
    where: { id: fulfillmentOrderId },
    data: { status: 'READY_TO_SHIP' },
  });
  await auditLog({ tenantId, actorId, action: 'ready_to_ship', entityType: 'FulfillmentOrder', entityId: fulfillmentOrderId });
}

/**
 * Hand over to carrier. READY_TO_SHIP → HANDED_OVER.
 * Atomically: deduct on-hand stock, consume active reservations,
 * write DEDUCTION ledger rows, mark items FULFILLED, create Shipment(READY_TO_SHIP).
 * ADR-003 (ledger), FR-FUL-006, FR-SHP-001.
 */
export async function handOverToCarrier(
  tenantId: string,
  fulfillmentOrderId: string,
  actorId: string,
  carrier?: string,
  awb?: string,
): Promise<{ shipmentId: string }> {
  const fo = await prisma.fulfillmentOrder.findFirst({
    where: { id: fulfillmentOrderId, order: { tenantId } },
    include: {
      order: {
        include: {
          items: { include: { reservations: { where: { status: 'ACTIVE' } } } },
          shipments: true,
        },
      },
    },
  });
  if (!fo) throw new NotFoundError('Fulfillment order', fulfillmentOrderId);
  assertTransition(fo.status, 'HANDED_OVER');

  const shipment = await prisma.$transaction(async (tx) => {
    // 1. Deduct physical stock + consume reservations + ledger (per order item)
    for (const item of fo.order.items) {
      const remaining = item.quantity - item.fulfilledQuantity;
      if (remaining > 0) {
        await tx.inventoryBalance.update({
          where: { warehouseId_variantId: { warehouseId: fo.warehouseId, variantId: item.variantId } },
          data: { onHand: { decrement: remaining }, version: { increment: 1 } },
        });
        await tx.inventoryMovement.create({
          data: {
            tenantId,
            warehouseId: fo.warehouseId,
            variantId: item.variantId,
            movementType: 'DEDUCTION',
            quantityDelta: -remaining,
            referenceType: 'order',
            referenceId: fo.orderId,
            reason: 'Pengiriman — stok dikeluarkan',
            actorId,
          },
        });
      }
      // Release/consume any active reservation (reserved was previously incremented).
      for (const res of item.reservations) {
        await tx.inventoryBalance.update({
          where: { warehouseId_variantId: { warehouseId: res.warehouseId, variantId: item.variantId } },
          data: { reserved: { decrement: res.quantity }, version: { increment: 1 } },
        });
        await tx.stockReservation.update({ where: { id: res.id }, data: { status: 'CONSUMED' } });
      }
      await tx.orderItem.update({
        where: { id: item.id },
        data: { fulfilledQuantity: item.quantity, status: 'FULFILLED' },
      });
    }

    // 2. Create or reuse shipment
    const activeShipment = fo.order.shipments.find((s) => s.status === 'READY_TO_SHIP' || s.status === 'PENDING');
    const shipment =
      activeShipment ??
      (await tx.shipment.create({
        data: { orderId: fo.orderId, awb: awb ?? null, carrier: carrier ?? null, status: 'READY_TO_SHIP' },
      }));

    // 3. Fulfillment → HANDED_OVER
    await tx.fulfillmentOrder.update({
      where: { id: fulfillmentOrderId },
      data: { status: 'HANDED_OVER', completedAt: new Date() },
    });

    return shipment;
  });

  await auditLog({
    tenantId,
    actorId,
    action: 'handover_to_carrier',
    entityType: 'FulfillmentOrder',
    entityId: fulfillmentOrderId,
    metadata: { shipmentId: shipment.id, carrier, awb },
  });
  logger.info('Handover to carrier', { tenantId, fulfillmentOrderId, shipmentId: shipment.id });
  return { shipmentId: shipment.id };
}
