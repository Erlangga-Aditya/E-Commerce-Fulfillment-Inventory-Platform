#!/usr/bin/env bash
# Ukur biaya query halaman Pesanan + durasi siklus sinkronisasi. READ-ONLY.
set -u
cd /opt/efulfill/app || exit 1
set -a; . ./.env; set +a

echo "===== RESOURCE ====="
echo "vCPU: $(nproc)"
uptime
free -m | head -2
df -h / | tail -1
echo "swap: $(swapon --show=SIZE --noheadings 2>/dev/null | tr -d ' ' || echo 0)"

echo
echo "===== PM2 ====="
pm2 describe efulfill 2>/dev/null | grep -E "restarts|uptime|memory|cpu|instances|exec mode" | head -8

echo
echo "===== UKURAN ASET ====="
du -sh .next/static 2>/dev/null
ls .next/static/chunks/*.js 2>/dev/null | wc -l

echo
echo "===== BIAYA QUERY HALAMAN PESANAN ====="
cat > /tmp/q.js <<'JS'
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  const tenant = await p.tenant.findFirst({ select: { id: true } });
  const t0 = Date.now();
  const orders = await p.order.findMany({
    where: { tenantId: tenant.id, status: { in: ['NEW','CONFIRMED','CANCELLED','COMPLETED'] } },
    include: {
      shop: { select: { name: true, provider: true } },
      items: { include: { variant: { include: { product: { select: { name: true } } } }, reservations: { where: { status: 'ACTIVE' }, select: { quantity: true } } } },
      shipments: { orderBy: { createdAt: 'desc' }, take: 1 },
      fulfillmentOrders: { where: { status: { notIn: ['COMPLETED'] } }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: [{ shipByAt: 'asc' }, { placedAt: 'asc' }],
    take: 5001,
  });
  const tQuery = Date.now() - t0;
  const t1 = Date.now();
  const variantIds = [...new Set(orders.flatMap(o => o.items.map(i => i.variantId)))];
  const bal = await p.inventoryBalance.findMany({ where: { variantId: { in: variantIds } }, select: { variantId: true, warehouseId: true, onHand: true, reserved: true, blocked: true } });
  const tAvail = Date.now() - t1;
  console.log(`kandidat pesanan : ${orders.length} baris dalam ${tQuery} ms`);
  console.log(`item + varian    : ${orders.reduce((s,o)=>s+o.items.length,0)} baris`);
  console.log(`saldo stok       : ${bal.length} baris dalam ${tAvail} ms`);
  console.log(`TOTAL kasar      : ${tQuery + tAvail} ms`);
  await p.$disconnect();
})().catch(async e => { console.error('GAGAL:', e.message); await p.$disconnect().catch(()=>{}); });
JS
node /tmp/q.js
rm -f /tmp/q.js

echo
echo "===== SIKLUS SINKRONISASI (dari log) ====="
pm2 logs efulfill --nostream --lines 600 2>/dev/null \
  | grep -E "Shopee sync:|AWB dipulihkan|Shipment auto-created|status pengiriman|Sinkronisasi otomatis Shopee aktif" \
  | tail -20
