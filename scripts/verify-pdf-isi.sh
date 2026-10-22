#!/usr/bin/env bash
# Ekstraksi teks PDF: content stream + decode hex-string "<...>" (gaya pdf-lib).
set -uo pipefail
cd /opt/efulfill/app
B=http://127.0.0.1:3000
J=/tmp/vp9.txt
rm -f "$J"
curl -s -c "$J" -X POST "$B/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@toko.id","password":"Owner12345"}' -o /dev/null
curl -s -b "$J" -X POST "$B/api/v1/fulfillment/production-list" \
  -H 'Content-Type: application/json' -d '{}' -o /tmp/pdf_cek.pdf -w "HTTP %{http_code}\n"
node -e "
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const zlib = require('zlib');
(async () => {
  const doc = await PDFDocument.load(fs.readFileSync('/tmp/pdf_cek.pdf'));
  const ctx = doc.context;
  let streamTxt = '';
  for (const p of doc.getPages()) {
    const c = p.node.Contents();
    const arr = c && c.asArray ? c.asArray() : (c ? [c] : []);
    for (const item of arr) {
      let s = item;
      if (item && item.constructor.name === 'PDFRef') s = ctx.lookup(item);
      if (!s || !s.contents) continue;
      try { streamTxt += zlib.inflateRawSync(Buffer.from(s.contents)).toString('latin1'); }
      catch (e) { streamTxt += Buffer.from(s.contents).toString('latin1'); }
    }
  }
  // pdf-lib menulis teks sbg hex-string <...> (font custom encoding 1:1) → decode
  let txt = '';
  const hexRe = /<([0-9A-Fa-f]{2,})>/g;
  let m;
  let hexTotal = 0;
  while ((m = hexRe.exec(streamTxt))) {
    const bytes = m[1].match(/../g).map((b) => String.fromCharCode(parseInt(b, 16))).join('');
    txt += bytes;
    hexTotal += bytes.length;
  }
  // string literal biasa (kurung) juga ikut
  const litRe = /\(([^()]{2,})\)/g;
  while ((m = litRe.exec(streamTxt))) txt += m[1];
  const cek = (label, ada) => console.log((ada ? 'OK  ' : 'GAGAL') + ' ' + label);
  cek('section PALING DEKAT DIBATALKAN OTOMATIS ada', txt.includes('PALING DEKAT DIBATALKAN OTOMATIS'));
  cek('kolom Deadline ada', txt.includes('Deadline'));
  cek('kolom Sisa waktu ada', txt.includes('Sisa waktu'));
  cek('kolom Tanggal TIDAK ada', !txt.includes('Tanggal'));
  cek('tabel Produk/Qty ada', txt.includes('Produk') && txt.includes('Qty'));
  cek('tanda tangan TIDAK ada', !txt.includes('Diserahkan ke tim produksi') && !txt.includes('Tanggal: ____'));
  cek('batch & jumlah tercetak', txt.includes('Batch') && txt.includes('pesanan'));
  const contoh = (txt.match(/Lewat [^|]{0,18}|Sisa [^|]{0,20}/g) || []).slice(0, 3);
  console.log('contoh teks:', JSON.stringify(contoh));
  console.log('hex terdecode:', hexTotal, 'karakter');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
" 2>&1 | tail -13