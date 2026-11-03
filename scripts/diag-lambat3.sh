#!/usr/bin/env bash
# Spesifikasi, indeks, dan pola beban sinkronisasi. READ-ONLY.
set -u
cd /opt/efulfill/app || exit 1
set -a; . ./.env; set +a

echo "===== SPESIFIKASI ====="
echo "vCPU      : $(nproc)"
echo "RAM total : $(free -m | awk '/Mem:/{print $2}') MB"
echo "RAM bebas : $(free -m | awk '/Mem:/{print $7}') MB"
free -m | head -3
echo "load      : $(cat /proc/loadavg)"
echo "disk      : $(df -h / | awk 'NR==2{print $3"/"$2" ("$5")"}')"

echo
echo "===== PM2 MEMORY/CPU ====="
pm2 jlist 2>/dev/null | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  try{const a=JSON.parse(s);for(const p of a){console.log(\`\${p.name}: cpu=\${p.monit?.cpu ?? '-'}% mem=\${Math.round((p.monit?.memory ?? 0)/1048576)} MB restarts=\${p.pm2_env?.restart_time} uptime=\${Math.round(((Date.now()-(p.pm2_env?.pm_uptime||Date.now()))/60000))}m\`)}}
  catch(e){console.log('(tidak bisa baca jlist)')}
});"

echo
echo "===== INDEKS TABEL PENTING ====="
cat > /tmp/idx.js <<'JS'
const { PrismaClient } = require('/opt/efulfill/app/node_modules/@prisma/client');
const p = new PrismaClient();
(async () => {
  for (const t of ['orders','shipments','fulfillment_orders','order_items','stock_reservations']) {
    const rows = await p.$queryRawUnsafe(`SHOW INDEX FROM ${t}`);
    const k = {};
    for (const r of rows) { k[r.Key_name] = k[r.Key_name] ?? []; k[r.Key_name].push(r.Column_name); }
    console.log(`${t}:`);
    for (const [name, cols] of Object.entries(k)) console.log(`  ${name} (${cols.join(',')})`);
  }
  const cnt = await p.$queryRawUnsafe("SELECT table_name AS t, table_rows AS r FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('orders','shipments','fulfillment_orders','order_items','audit_logs','tracking_events')");
  console.log('\nperkiraan baris:');
  for (const c of cnt) console.log(`  ${c.t}: ${typeof c.r === 'bigint' ? Number(c.r) : c.r}`);
  await p.$disconnect();
})().catch(async e => { console.error('GAGAL:', e.message); await p.$disconnect().catch(()=>{}); });
JS
node /tmp/idx.js
rm -f /tmp/idx.js

echo
echo "===== POLA SIKLUS SYNC (10 menit terakhir) ====="
pm2 logs efulfill --nostream --lines 2000 2>/dev/null \
  | grep -E "Shopee sync:|AWB dipulihkan|Shipment auto-created" \
  | awk -F'"timestamp":"' '{split($2,a,"\""); print substr(a[1],12,8), ($0 ~ /Shopee sync/ ? "SIKLUS-MULAI " $0 : ($0 ~ /AWB dipulihkan/ ? "AWB " : "SHIPMENT"))}' \
  | tail -30
echo "--- jumlah per menit ---"
pm2 logs efulfill --nostream --lines 4000 2>/dev/null \
  | grep -E "Shopee sync:|AWB dipulihkan|Shipment auto-created" \
  | awk -F'"timestamp":"' '{split($2,a,"\""); print substr(a[1],12,5)}' | sort | uniq -c | tail -12
