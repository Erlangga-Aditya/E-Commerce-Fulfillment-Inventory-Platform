#!/usr/bin/env bash
# Lihat isi content stream PDF mentah (bagaimana teks ditulis).
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vq3.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null
curl -s -b "$J" -X POST "$B/api/v1/fulfillment/production-list" \
  -H 'Content-Type: application/json' -d '{}' -o /tmp/pdf_cek.pdf
node -e "
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const zlib = require('zlib');
(async () => {
  const doc = await PDFDocument.load(fs.readFileSync('/tmp/pdf_cek.pdf'));
  const ctx = doc.context;
  let raw = '';
  for (const p of doc.getPages()) {
    const c = p.node.Contents();
    const arr = c && c.asArray ? c.asArray() : (c ? [c] : []);
    for (const item of arr) {
      let s = item;
      if (item && item.constructor.name === 'PDFRef') s = ctx.lookup(item);
      if (!s || !s.contents) continue;
      try { raw += zlib.inflateRawSync(Buffer.from(s.contents)).toString('latin1'); }
      catch (e) { raw += Buffer.from(s.contents).toString('latin1'); }
    }
  }
  console.log('panjang raw:', raw.length);
  console.log(raw.slice(0, 700));
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
" 2>&1 | tail -30