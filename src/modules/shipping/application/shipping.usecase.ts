import { z } from 'zod';
import { prisma } from '@/shared/infrastructure/prisma';
import type { ShipmentStatus } from '@prisma/client';
import {
  NotFoundError,
  ValidationError,
  InvalidStateTransitionError,
  BusinessRuleViolationError,
} from '@/shared/errors/AppError';
import { auditLog } from '@/modules/audit/application/auditLog.service';
import { transitionOrderStatus } from '@/modules/orders/application/order.usecase';
import { isValidShipmentTransition } from '../domain/shipping.entity';

export const CreateShipmentSchema = z.object({
  orderId: z.string().min(1),
  carrier: z.string().min(1).max(100),
  awb: z.string().max(100).optional(),
});

export const AddShipmentEventSchema = z.object({
  status: z.enum(['PENDING', 'READY_TO_SHIP', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED']),
  carrierStatus: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  occurredAt: z.coerce.date().optional(),
});

export async function createShipment(
  tenantId: string,
  input: z.infer<typeof CreateShipmentSchema>,
  actorId: string,
) {
  const parsed = CreateShipmentSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Data pengiriman tidak valid.', { fields: parsed.error.flatten().fieldErrors });

  const order = await prisma.order.findFirst({ where: { id: parsed.data.orderId, tenantId }, include: { shipments: true } });
  if (!order) throw new NotFoundError('Pesanan', parsed.data.orderId);

  const activeShipment = order.shipments.find((s) => !['DELIVERED', 'FAILED', 'RETURNED'].includes(s.status));
  if (activeShipment) {
    throw new BusinessRuleViolationError('Pesanan ini sudah memiliki pengiriman aktif.', { existingShipmentId: activeShipment.id });
  }

  const shipment = await prisma.$transaction(async (tx) => {
    const created = await tx.shipment.create({
      data: { orderId: parsed.data.orderId, carrier: parsed.data.carrier, awb: parsed.data.awb ?? null, status: 'READY_TO_SHIP' },
    });
    await tx.shipmentEvent.create({
      data: { shipmentId: created.id, status: 'READY_TO_SHIP', description: `Label pengiriman dibuat — kurir ${parsed.data.carrier}.`, occurredAt: new Date() },
    });
    return created;
  });

  await auditLog({ tenantId, actorId, action: 'shipment_create', entityType: 'Shipment', entityId: shipment.id, metadata: { orderId: parsed.data.orderId, carrier: parsed.data.carrier, awb: parsed.data.awb } });
  return shipment;
}

export async function addShipmentEvent(
  tenantId: string,
  shipmentId: string,
  input: z.infer<typeof AddShipmentEventSchema>,
  actorId: string,
) {
  const parsed = AddShipmentEventSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError('Data event pengiriman tidak valid.', { fields: parsed.error.flatten().fieldErrors });

  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, order: { tenantId } },
    include: { order: true },
  });
  if (!shipment) throw new NotFoundError('Pengiriman', shipmentId);

  const nextStatus = parsed.data.status as ShipmentStatus;
  if (nextStatus !== shipment.status && !isValidShipmentTransition(shipment.status, nextStatus)) {
    throw new InvalidStateTransitionError('Shipment', shipment.status, nextStatus);
  }

  const occurredAt = parsed.data.occurredAt || new Date();

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        status: nextStatus,
        ...(nextStatus === 'PICKED_UP' ? { shippedAt: occurredAt } : {}),
        ...(nextStatus === 'DELIVERED' ? { deliveredAt: occurredAt } : {}),
      },
    });
    await tx.shipmentEvent.create({
      data: { shipmentId, status: parsed.data.carrierStatus, description: parsed.data.description, occurredAt },
    });
  });

  // Delivered → order COMPLETED (only from CONFIRMED).
  if (nextStatus === 'DELIVERED' && shipment.order.status === 'CONFIRMED') {
    await transitionOrderStatus(tenantId, shipment.orderId, 'COMPLETED', actorId, 'Paket telah diterima pembeli');
  }

  await auditLog({ tenantId, actorId, action: 'shipment_event_add', entityType: 'Shipment', entityId: shipmentId, metadata: { status: nextStatus, carrierStatus: parsed.data.carrierStatus } });
}

export async function listShipments(
  tenantId: string,
  options: { status?: ShipmentStatus; carrier?: string; search?: string; page?: number; pageSize?: number } = {},
) {
  const { status, carrier, search, page = 1, pageSize = 20 } = options;
  const skip = (page - 1) * pageSize;

  const where = {
    order: { tenantId },
    ...(status ? { status } : {}),
    ...(carrier ? { carrier: { contains: carrier } } : {}),
    ...(search
      ? { OR: [
          { awb: { contains: search } },
          { order: { externalOrderId: { contains: search } } },
          { order: { buyerName: { contains: search } } },
        ] }
      : {}),
  };

  const [shipments, total] = await Promise.all([
    prisma.shipment.findMany({
      where,
      include: {
        order: { select: { id: true, externalOrderId: true, buyerName: true, buyerPhone: true, status: true, shop: { select: { name: true, provider: true } } } },
        events: { orderBy: { occurredAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.shipment.count({ where }),
  ]);

  return {
    items: shipments.map((s) => ({
      id: s.id,
      orderId: s.orderId,
      externalOrderId: s.order.externalOrderId,
      shopName: s.order.shop.name,
      buyerName: s.order.buyerName,
      carrier: s.carrier,
      awb: s.awb,
      status: s.status,
      shippedAt: s.shippedAt,
      deliveredAt: s.deliveredAt,
      createdAt: s.createdAt,
      latestEvent: s.events[0] || null,
    })),
    pagination: { total, page, pageSize, hasMore: skip + pageSize < total },
  };
}

export async function getShipmentById(tenantId: string, shipmentId: string) {
  const shipment = await prisma.shipment.findFirst({
    where: { id: shipmentId, order: { tenantId } },
    include: {
      order: { include: { shop: { select: { name: true, provider: true } }, items: { include: { variant: { select: { sku: true, name: true } } } } } },
      events: { orderBy: { occurredAt: 'desc' } },
    },
  });
  if (!shipment) throw new NotFoundError('Pengiriman', shipmentId);
  return shipment;
}
