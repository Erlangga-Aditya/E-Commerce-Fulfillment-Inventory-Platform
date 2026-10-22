#!/usr/bin/env bash
# Backfill sekali jalan: tutup fulfillmentOrder yang masih menunggu stok padahal
# pesanannya sudah batal di Shopee (anomali produksi yang ditemukan 2026-10-22).
set -uo pipefail
cd /opt/efulfill/app
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  // 1) Pesanan batal yang masih punya fulfillment aktif
  const orders = await p.order.findMany({
    where: { status: 'CANCELLED' },
    select: { id: true, tenantId: true, externalOrderId: true },
  });
  let marked = 0, released = 0;
  for (const o of orders) {
    const res = await p.fulfillmentOrder.updateMany({
      where: { orderId: o.id, status: { notIn: ['COMPLETED', 'EXCEPTION'] } },
      data: { status: 'EXCEPTION' },
    });
    if (res.count > 0) {
      marked += res.count;
      console.log('FO->EXCEPTION', o.externalOrderId, res.count);
    }
    const aktif = await p.stockReservation.findMany({
      where: { orderItem: { orderId: o.id }, status: 'ACTIVE' },
      select: { id: true, warehouseId: true, variantId: true, quantity: true },
    });
    for (const r of aktif) {
      await p.stockReservation.update({ where: { id: r.id }, data: { status: 'RELEASED', releasedAt: new Date() } });
      await p.inventoryBalance.update({
        where: { warehouseId_variantId: { warehouseId: r.warehouseId, variantId: r.variantId } },
        data: { reserved: { decrement: r.quantity }, version: { increment: 1 } },
      });
      await p.inventoryMovement.create({
        data: {
          tenantId: o.tenantId, warehouseId: r.warehouseId, variantId: r.variantId,
          movementType: 'RESERVE_RELEASE', quantityDelta: r.quantity,
          referenceType: 'order', referenceId: o.id,
          reason: 'Backfill: pesanan dibatalkan di Shopee', actorId: null,
        },
      });
      released++;
    }
  }
  console.log('=== HASIL ===');
  console.log('fulfillment ditutup:', marked, '| reservasi dilepas:', released);

  // 2) Sisa yang masih WAITING_STOCK sekarang = pekerjaan gudang yang asli
  const total = await p.fulfillmentOrder.count({ where: { status: 'WAITING_STOCK' } });
  const err = await p.fulfillmentOrder.count({ where: { status: 'EXCEPTION' } });
  const yatim = await p.fulfillmentOrder.count({
    where: { status: 'WAITING_STOCK', order: { status: 'CANCELLED' } },
  });
  console.log('WAITING_STOCK tersisa:', total, '| EXCEPTION:', err, '| masih yatim:', yatim);
  await p.\$disconnect();
})().catch(async (e) => { console.error('ERR', e.message); await p.\$disconnect(); process.exit(1); });
" 2>&1 | head -40