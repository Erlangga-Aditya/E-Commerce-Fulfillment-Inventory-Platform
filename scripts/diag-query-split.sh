#!/usr/bin/env bash
set -u
cd /opt/efulfill/app || exit 1
set -a; . ./.env; set +a
cat > /tmp/split.js <<'JS'
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();
const st = ['NEW','CONFIRMED','CANCELLED','COMPLETED'];
(async () => {
  const tenant = await p.tenant.findFirst({ select: { id: true } });
  // A) ringan: hanya kolom untuk klasifikasi + tampilan kartu
  let t = Date.now();
  const light = await p.order.findMany({
    where: { tenantId: tenant.id, status: { in: st } },
    select: {
      id: true, externalOrderId: true, buyerName: true, placedAt: true, shipByAt: true,
      status: true, externalStatus: true, priorityLevel: true, cancelBy: true, cancelReason: true,
      buyerCancelReason: true, cancelRequestedAt: true, cancelledAt: true,
      shipments: { select: { awb: true, carrier: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      fulfillmentOrders: { select: { id: true, status: true, warehouseId: true, pickedById: true, packedById: true, handedOverById: true, packedAt: true, handedOverAt: true }, where: { status: { notIn: ['COMPLETED'] } }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: [{ shipByAt: 'asc' }, { placedAt: 'asc' }],
    take: 5001,
  });
  const tLight = Date.now() - t;
  // B) detail untuk 20 baris halaman
  t = Date.now();
  const ids = light.slice(0, 20).map(o => o.id);
  const detail = await p.order.findMany({
    where: { id: { in: ids } },
    include: { items: { include: { variant: { include: { product: { select: { name: true } } } }, reservations: { where: { status: 'ACTIVE' }, select: { quantity: true } } } } },
  });
  const tDetail = Date.now() - t;
  console.log(`A) ringan 571 baris : ${tLight} ms`);
  console.log(`B) detail 20 pesanan: ${tDetail} ms`);
  console.log(`TOTAL pendekatan baru: ${tLight + tDetail} ms`);
  console.log(`(sekarang: satu query penuh ~656 ms untuk SEMUA baris)`);
  await p.$disconnect();
})().catch(async e => { console.error('GAGAL:', e.message); await p.$disconnect().catch(()=>{}); });
JS
node /tmp/split.js
rm -f /tmp/split.js
