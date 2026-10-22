#!/usr/bin/env bash
# Keluarkan PDF produksi dalam base64 (ISO kecil) untuk dibuka & dilihat.
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vq4.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null
curl -s -b "$J" -X POST "$B/api/v1/fulfillment/production-list" \
  -H 'Content-Type: application/json' -d '{}' -o /tmp/pdf_final.pdf -w "HTTP %{http_code} "
echo "ukuran $(wc -c < /tmp/pdf_final.pdf) byte"
base64 -w 0 /tmp/pdf_final.pdf
echo