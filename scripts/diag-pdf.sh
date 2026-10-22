#!/usr/bin/env bash
# Diagnosa: struktur Contents PDF di pdf-lib versi server + coba beberapa ekstraksi.
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vq2.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null
curl -s -b "$J" -X POST "$B/api/v1/fulfillment/production-list" \
  -H 'Content-Type: application/json' -d '{}' -o /tmp/pdf_dbg.pdf
node -e "
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const zlib = require('zlib');
(async () => {
  const doc = await PDFDocument.load(fs.readFileSync('/tmp/pdf_dbg.pdf'));
  const p = doc.getPages()[0];
  const c = p.node.Contents();
  console.log('Contents type:', c && c.constructor && c.constructor.name, '| null?', c === null);
  if (c && c.asArray) console.log('array len:', c.asArray().length);
  const dump = (s) => {
    if (!s) return '';
    if (s.constructor.name === 'PDFRawStream') {
      try { return zlib.inflateRawSync(Buffer.from(s.contents)).toString('latin1'); } catch (e) { return 'inflate-gagal:' + e.message; }
    }
    if (s.contents) return s.contents.toString('latin1');
    return 'tipe:' + s.constructor.name;
  };
  let txt = '';
  const arr = c && c.asArray ? c.asArray() : (c ? [c] : []);
  arr.forEach((s, i) => {
    const t = dump(s);
    console.log('stream', i, '->', t.slice(0, 80));
    txt += t;
  });
  console.log('TOTAL teks:', txt.length, '| berisi DAFTAR:', txt.includes('DAFTAR'));
  console.log(txt.slice(0, 300));
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
" 2>&1 | tail -14