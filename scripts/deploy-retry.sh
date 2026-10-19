#!/usr/bin/env bash
# Deploy ke VPS dengan percobaan ulang.
#
# Koneksi SSH ke VPS ini kadang ditolak sesaat (rate limit / fail2ban): satu
# percobaan berhasil, percobaan berikutnya langsung ditutup. Karena itu seluruh
# rantai (kirim → ekstrak → build → restart → health) dijalankan dalam SATU
# koneksi, lalu diulang beberapa kali bila koneksi ditolak.
set -uo pipefail
cd /d/jhe/E-fullhub || exit 1

SSHOPT="-i $HOME/.ssh/id_ed25519 -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=12 -o ServerAliveInterval=20 -o ServerAliveCountMax=6"
TARGET="root@103.178.174.224"

REMOTE_CMD='set -e
cd /opt/efulfill/app
tar xzf - --overwrite
npx prisma generate > /tmp/gen.log 2>&1
npm run build > /tmp/be.log 2>&1
BUILD=$?
pm2 restart efulfill --update-env > /dev/null 2>&1
sleep 8
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/login)
echo "BUILD_EXIT=$BUILD HEALTH=$HEALTH"
'

for i in 1 2 3 4; do
  echo "--- percobaan $i ---"
  OUT=$(tar czf - src prisma | timeout 420 ssh $SSHOPT "$TARGET" "$REMOTE_CMD" 2>&1 | tail -3)
  echo "$OUT"
  if echo "$OUT" | grep -q "HEALTH=200"; then
    echo "DEPLOY_OK"
    exit 0
  fi
  # Jeda panjang: VPS membatasi percobaan SSH beruntun (rate limit).
  sleep 150
done

echo "DEPLOY_GAGAL"
exit 1
