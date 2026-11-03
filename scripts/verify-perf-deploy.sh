#!/usr/bin/env bash
set -u
cd /opt/efulfill/app || exit 1
echo -n "md5 fulfillment.usecase.ts : "; md5sum src/modules/fulfillment/application/fulfillment.usecase.ts | awk '{print $1}'
echo -n "kode split aktif           : "; grep -c "SELECT RINGAN" src/modules/fulfillment/application/fulfillment.usecase.ts
echo -n "health /login              : "; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/login
echo -n "uptime pm2                 : "; pm2 describe efulfill 2>/dev/null | grep -E "uptime" | head -1
