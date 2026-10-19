#!/usr/bin/env bash
# READ-ONLY: mengukur kategori "pembatalan diajukan", "batal sistem", dan
# "terlambat" memakai data yang SUDAH ada di database produksi.
set -uo pipefail
cd /opt/efulfill/app
DBURL=$(grep '^DATABASE_URL' .env | cut -d= -f2- | tr -d '"')
DBUSER=$(echo "$DBURL" | sed -E 's#mysql://([^:]+):([^@]+)@.*#\1#')
DBPASS=$(echo "$DBURL" | sed -E 's#mysql://([^:]+):([^@]+)@.*#\2#')
DBNAME=$(echo "$DBURL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')
q() { mysql -u"$DBUSER" -p"$DBPASS" "$DBNAME" -t -e "$1" 2>/dev/null; }

echo "== 1. Sebaran status mentah Shopee (semua pesanan) =="
q "select coalesce(external_status,'(null)') as status_shopee, count(*) as jumlah
     from orders group by status_shopee order by jumlah desc;"

echo "== 2. Pembatalan diajukan (IN_CANCEL) =="
q "select o.external_order_id, o.status as status_internal, o.external_status,
          date_add(o.placed_at, interval 7 hour) as masuk_wib,
          coalesce(date_add(o.ship_by_at, interval 7 hour),'-') as batas_kirim_wib,
          coalesce(s.awb,'-') as resi, coalesce(s.status,'-') as status_kirim,
          coalesce(fo.status,'-') as status_fulfillment
     from orders o
     left join shipments s on s.order_id = o.id
     left join fulfillment_orders fo on fo.order_id = o.id
    where o.external_status = 'IN_CANCEL'
    order by o.placed_at desc limit 10;"

echo "== 3. Terlambat: batas kirim sudah lewat tetapi belum dikirim =="
q "select o.external_status, count(*) as jumlah,
          sum(case when s.awb is null then 1 else 0 end) as belum_ada_resi
     from orders o
     left join shipments s on s.order_id = o.id
    where o.status <> 'CANCELLED'
      and o.external_status in ('READY_TO_SHIP','PROCESSED','RETRY_SHIP')
      and o.ship_by_at is not null and o.ship_by_at < utc_timestamp()
    group by o.external_status;"

echo "== 4. Akan batal besok (batas kirim dalam 24 jam ke depan) =="
q "select o.external_status, count(*) as jumlah
     from orders o
    where o.status <> 'CANCELLED'
      and o.external_status in ('READY_TO_SHIP','PROCESSED','RETRY_SHIP')
      and o.ship_by_at >= utc_timestamp()
      and o.ship_by_at < date_add(utc_timestamp(), interval 1 day)
    group by o.external_status;"

echo "== 5. Beresiko terlambat (batas kirim 1-3 hari lagi) =="
q "select o.external_status, count(*) as jumlah
     from orders o
    where o.status <> 'CANCELLED'
      and o.external_status in ('READY_TO_SHIP','PROCESSED','RETRY_SHIP')
      and o.ship_by_at >= date_add(utc_timestamp(), interval 1 day)
      and o.ship_by_at < date_add(utc_timestamp(), interval 3 day)
    group by o.external_status;"

echo "== 6. Dibatalkan: bisa dibedakan pelakunya? =="
q "select count(*) as total_batal,
          sum(case when external_status='CANCELLED' then 1 else 0 end) as tercatat_cancelled
     from orders where status='CANCELLED';"
q "show columns from orders like '%cancel%';"
