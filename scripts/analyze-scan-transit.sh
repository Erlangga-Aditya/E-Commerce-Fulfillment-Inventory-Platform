#!/usr/bin/env bash
# READ-ONLY: analisa pesanan "dalam perjalanan" yang fulfillment order-nya
# belum HANDED_OVER — inilah yang memicu "harus tambah stok" saat scan resi.
set -uo pipefail
cd /opt/efulfill/app
DBURL=$(grep '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')
DBUSER=$(echo "$DBURL" | sed -E 's#mysql://([^:]+):([^@]+)@.*#\1#')
DBPASS=$(echo "$DBURL" | sed -E 's#mysql://([^:]+):([^@]+)@.*#\2#')
DBNAME=$(echo "$DBURL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')
q() { mysql -u"$DBUSER" -p"$DBPASS" "$DBNAME" -t -e "$1" 2>/dev/null; }

echo "== 1. Sebaran: status kirim x status fulfillment (hanya yang punya resi) =="
q "
select s.status as status_kirim, fo.status as status_fulfillment, count(*) as jumlah
  from orders o
  join shipments s on s.order_id = o.id
  left join fulfillment_orders fo on fo.order_id = o.id
 where s.status in ('PICKED_UP','IN_TRANSIT')
 group by s.status, fo.status
 order by jumlah desc;"

echo "== 2. Berapa yang AKAN kena jalur stok kalau di-scan sekarang =="
q "
select count(distinct o.id) as akan_kena_stok
  from orders o
  join shipments s on s.order_id = o.id
  join fulfillment_orders fo on fo.order_id = o.id
 where s.status in ('PICKED_UP','IN_TRANSIT')
   and o.status not in ('CANCELLED','COMPLETED')
   and fo.status not in ('HANDED_OVER','COMPLETED','PACKED','READY_TO_SHIP','EXCEPTION');"

echo "== 3. Contoh 5 pesanan yang kena, + stok tersedia variannya =="
q "
select o.external_order_id, s.status as kirim, fo.status as fulfillment,
       (select count(*) from order_items oi where oi.order_id = o.id) as baris_item
  from orders o
  join shipments s on s.order_id = o.id
  join fulfillment_orders fo on fo.order_id = o.id
 where s.status in ('PICKED_UP','IN_TRANSIT')
   and o.status not in ('CANCELLED','COMPLETED')
   and fo.status not in ('HANDED_OVER','COMPLETED','PACKED','READY_TO_SHIP','EXCEPTION')
 order by o.placed_at desc
 limit 5;"

echo "== 4. Apakah stok varian pesanan tsb memang habis? (5 contoh teratas) =="
q "
select o.external_order_id, v.sku, ib.on_hand, ib.reserved, ib.blocked,
       (ib.on_hand - ib.reserved - ib.blocked) as tersedia, oi.quantity as butuh
  from orders o
  join shipments s on s.order_id = o.id
  join fulfillment_orders fo on fo.order_id = o.id
  join order_items oi on oi.order_id = o.id
  join product_variants v on v.id = oi.variant_id
  left join inventory_balances ib on ib.variant_id = oi.variant_id and ib.warehouse_id = fo.warehouse_id
 where s.status in ('PICKED_UP','IN_TRANSIT')
   and o.status not in ('CANCELLED','COMPLETED')
   and fo.status not in ('HANDED_OVER','COMPLETED','PACKED','READY_TO_SHIP','EXCEPTION')
 order by o.placed_at desc
 limit 8;"

echo "== 5. Sudah pernah dipotong stoknya? (ada StockMovement keluar utk pesanan ini) =="
q "
select count(distinct o.id) as punya_movement_keluar
  from orders o
  join shipments s on s.order_id = o.id
  join fulfillment_orders fo on fo.order_id = o.id
 where s.status in ('PICKED_UP','IN_TRANSIT')
   and exists (select 1 from stock_movements sm
                where sm.reference_type = 'FulfillmentOrder' and sm.reference_id = fo.id);"
