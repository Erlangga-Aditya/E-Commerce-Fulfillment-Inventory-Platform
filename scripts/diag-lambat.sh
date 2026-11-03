#!/usr/bin/env bash
# Diagnosa performa VPS (READ-ONLY): resource, node, mysql, nginx, sync.
set -u
APP=/opt/efulfill/app
cd "$APP" || exit 1

echo "===== 1. RESOURCE ====="
nproc
uptime
free -m
df -h / | tail -1
echo "--- swap ---"
swapon --show 2>/dev/null || echo "(tanpa swap)"

echo
echo "===== 2. PM2 ====="
pm2 list 2>/dev/null | sed -n '1,12p'
pm2 describe efulfill 2>/dev/null | grep -E "restarts|uptime|memory|cpu|script path|exec mode|instances" | head -10

echo
echo "===== 3. PROSES PALING BERAT (CPU/MEM) ====="
ps -eo pid,ppid,pcpu,pmem,rss,etime,comm --sort=-pcpu | head -8

echo
echo "===== 4. MYSQL ====="
set -a; . ./.env; set +a
cat > /tmp/my.js <<'JS'
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();
const num = v => typeof v === 'bigint' ? Number(v) : v;
(async () => {
  const ver = await p.$queryRawUnsafe('SELECT VERSION() AS v');
  console.log('versi:', ver[0].v);
  const vars = await p.$queryRawUnsafe("SHOW VARIABLES WHERE Variable_name IN ('innodb_buffer_pool_size','max_connections','slow_query_log','long_query_time','table_open_cache','tmp_table_size')");
  for (const r of vars) console.log(`${r.Variable_name} = ${r.Value}`);
  const size = await p.$queryRawUnsafe(
    "SELECT table_name, ROUND((data_length+index_length)/1024/1024,1) AS mb, table_rows FROM information_schema.tables WHERE table_schema=DATABASE() ORDER BY (data_length+index_length) DESC LIMIT 8");
  console.log('tabel terbesar:');
  for (const r of size) console.log(`  ${r.table_name}: ${r.mb} MB, ~${num(r.table_rows)} baris`);
  const proc = await p.$queryRawUnsafe('SHOW PROCESSLIST');
  console.log('koneksi aktif:', proc.length);
  for (const c of proc.slice(0, 6)) console.log(`  ${c.Command} ${c.Time}s ${String(c.Info ?? '').slice(0, 90)}`);
  const q1 = Date.now();
  await p.order.count();
  console.log('waktu query COUNT(orders):', Date.now() - q1, 'ms');
  await p.$disconnect();
})().catch(async e => { console.error('GAGAL mysql:', e.message); await p.$disconnect().catch(()=>{}); });
JS
node /tmp/my.js
rm -f /tmp/my.js

echo
echo "===== 5. NGINX ====="
nginx -v 2>&1 | head -2
nginx -T 2>/dev/null | grep -E "gzip on|gzip_types|brotli|http2|proxy_cache|client_max_body_size" | head -10
echo "--- access log 5 terakhir ---"
tail -5 /var/log/nginx/access.log 2>/dev/null || echo "(log tidak ada)"

echo
echo "===== 6. WAKTU RENDER LOKAL (di VPS) ====="
for path in /login /dashboard/pesanan /api/v1/fulfillment/station; do
  printf "%-32s " "$path"
  curl -s -o /dev/null -w "http=%{http_code} ttfb=%{time_starttransfer}s total=%{time_total}s\n" --max-time 30 "http://127.0.0.1:3000$path"
done

echo
echo "===== 7. SCHEDULER SYNC ====="
grep -E "AUTO_SYNC" .env 2>/dev/null || echo "(AUTO_SYNC tidak diset → default)"
pm2 logs efulfill --nostream --lines 40 2>/dev/null | grep -iE "sinkronisasi otomatis|sync|AWB dipulihkan" | tail -10
