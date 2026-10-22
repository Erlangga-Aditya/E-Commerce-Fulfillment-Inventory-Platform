#!/usr/bin/env bash
# Cek instalasi pdf-parse + fallback ekstraksi nodejs langsung.
set -uo pipefail
cd /opt/efulfill/app
mkdir -p /tmp/pdfcheck && cd /tmp/pdfcheck
echo "=== isi /tmp/pdfcheck ==="
ls -la node_modules/pdf-parse 2>/dev/null | head -3 || echo "belum ada"
echo "=== coba install (lihat error) ==="
npm install --no-audit --no-fund pdf-parse@1.1.1 2>&1 | tail -4
ls node_modules/pdf-parse 2>/dev/null | head -3 && echo "INSTALL_OK"