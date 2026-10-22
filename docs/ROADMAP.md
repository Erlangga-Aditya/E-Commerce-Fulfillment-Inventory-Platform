# Roadmap & Task — E-Fulfill Hub

**Satu-satunya sumber kebenaran** untuk tujuan, keputusan, status pekerjaan, dan
sisa pekerjaan. Dokumen lain di repo:

| Dokumen | Isi |
|---|---|
| `README.md` | cara menjalankan, menguji, dan men-deploy |
| `deploy/RUNBOOK-OPERASIONAL.md` | prosedur darurat VPS (disk, migrasi, status) |
| `docs/panduan-operator.md` | panduan pemakaian untuk operator gudang |
| `CLAUDE.md` / `AGENTS.md` | aturan kerja untuk agen/editor kode |

Selain itu **tidak ada** dokumen lain. Kalau ada informasi baru, tambahkan ke
salah satu dari empat berkas di atas — jangan membuat berkas baru.

Terakhir diperbarui: 2026-10-20.

---

## 1. Tujuan produk

Aplikasi operasional gudang untuk penjual Shopee **buatan sendiri (make to
order)**: pesanan masuk → dipilih & divalidasi owner → kalau barang belum ada
diproduksi dulu → diambil dari gudang → dipacking → diserahkan ke kurir →
diterima kurir Shopee → diterima pembeli. Semua langkah harus **tercatat siapa
pelakunya**, karena pembayaran packer dan kurir internal dihitung **per paket**.

Prinsip yang tidak boleh dilanggar:

1. **Satu sumber kebenaran per keputusan.** Status paket ditentukan
   `shipments.status`; pekerjaan gudang ditentukan `fulfillment_orders.status`.
   Kalau bertentangan, paket yang menang (barangnya sudah keluar gudang).
2. **Stok jujur.** Tidak ada "berhasil" tanpa baris ledger. Stok minus adalah
   kejadian nyata yang harus terlihat, bukan disembunyikan.
3. **Setiap aksi punya aktor.** `audit_logs.actorId` wajib terisi; laporan
   per-orang dibangun dari situ.
4. **UI hanya menampilkan yang boleh dilakukan.** Server tetap penjaga terakhir
   (`assertPermission`), UI tidak boleh menebak.

---

## 2. Kondisi yang sudah berjalan (terverifikasi di produksi)

| Hal | Bukti |
|---|---|
| Kartu kerja: Baru / Sudah Ada Resi / Perlu Diproses | 24 + 6 = 30 (selaras Seller Centre) |
| Kartu pembatalan & keterlambatan | Diajukan 1 · Batal Sistem 29 · Terlambat 1 · Besok Batal 1 · Beresiko 17 |
| Scan paket in-transit | `ALREADY_IN_TRANSIT`, `stockDeducted: false` |
| Anomali paket sudah jalan tapi catatan tertinggal | **0** (74 ditutup, idempoten) |
| Filter tanggal WIB (hari ini/kemarin/7/30/semua) | terbukti menyaring (0/5/22/32) |
| Badge menu = kartu Perlu Diproses | 29 = 29 |
| Layout ponsel 360/393/414 px | 11 halaman × 3 lebar: 0 geser mendatar |
| Tema terang/gelap | token CSS + `data-theme`, kontras AA |
| Gate | `tsc` 0 · `lint` 0 · **336 test lulus** · build OK |
| VPS | `efulfill:online`, `health 200`, schema up to date, disk 10% |

---

## 3. Keputusan yang sudah dikunci

| # | Keputusan | Alasan |
|---|---|---|
| D1 | Status mentah Shopee (`external_status`) disimpan dan dipakai untuk klasifikasi | `READY_TO_SHIP` vs `PROCESSED` tidak bisa dibedakan dari status internal |
| D2 | `cancel_by` + `cancel_reason` + waktu pembatalan disimpan | Membedakan batal pembeli / penjual / sistem |
| D3 | **Tidak ada role selain OWNER.** Hak akses diberikan per akun lewat izin | Satu orang bisa merangkap packer + kurir; bayaran keduanya dihitung |
| D4 | **Pembayaran per paket: hanya jumlah, tanpa nominal rupiah** (ditunda) | Tarif belum diputuskan klien |
| D5 | **"Tolak pembatalan" tidak ditampilkan.** Hanya "Setujui" | Shopee v2 tidak punya API menolak pembatalan pembeli |
| D6 | Menyetujui pembatalan = `order/cancel_order`, tercatat `cancel_by=seller` | Bawaan API; disetujui owner. Hanya OWNER yang boleh |
| D7 | **Stok per jilid dan stok set TERPISAH** — tidak ada konversi/penambalan | Klien memproduksi ulang per jilid; set adalah stok jadi sendiri |
| D8 | **Saldo awal stok tidak diimpor** oleh aplikasi | Owner mengisi sendiri |
| D9 | Batal sistem karena `Unpaid Order` tidak dihitung "perlu perhatian" | Bukan kegagalan gudang |
| D10 | Banding/resi simulasi dilarang; angka harus berasal dari API/ledger | Kejujuran data |
| D11 | Retensi binlog MySQL **2 hari**; server tanpa replikasi | Sempat 34 GB → disk penuh, deploy gagal |
| D12 | Test integrasi berat (Python/PyMuPDF) dipisah: `npm run test:integration` | Gate harian harus cepat & deterministik |
| D13 | Pemilihan pesanan oleh owner: **saran otomatis + koreksi manual** | Owner tetap memutuskan, tetapi tidak mulai dari nol |

---

## 4. Model status (ringkas)

```
Pesanan (orders)
  status internal : NEW → CONFIRMED → CANCELLED / COMPLETED
  external_status : UNPAID|PENDING|READY_TO_SHIP|PROCESSED|RETRY_SHIP|SHIPPED|
                    TO_CONFIRM_RECEIVE|IN_CANCEL|CANCELLED|TO_RETURN
  cancel_by       : buyer | seller | system | Ops

Pekerjaan gudang (fulfillment_orders)
  WAITING_STOCK → READY_TO_PICK → PICKING → PICKED → PACKING → PACKED
                → READY_TO_SHIP → HANDED_OVER → COMPLETED        (+ EXCEPTION)

Paket (shipments)
  PENDING → READY_TO_SHIP → PICKED_UP → IN_TRANSIT → DELIVERED   (+ FAILED/RETURNED)
```

Aturan tampilan: pesanan yang paketnya sudah `PICKED_UP`/`IN_TRANSIT`/
`DELIVERED` **tidak pernah** masuk antrean kerja, dan scan resinya tidak
menyentuh stok.

---

## 5. Roadmap

### Fase 1 — Persetujuan pembatalan oleh owner (selesai, kecuali uji happy-path)
- [x] `POST /api/v1/orders/[orderId]/cancellation` — izin `order.cancel` **dan** peran OWNER
- [x] Adapter Shopee: `order/cancel_order` (`order_sn`, `cancel_reason: OTHERS`)
- [x] Aturan murni `domain/cancellation.ts` + 7 test (bukan owner, bukan pengajuan, sudah final, paket sudah jalan)
- [x] Audit `buyer_cancellation_approved` + pelepasan reservasi stok pesanan itu
- [x] Tombol "Setujui pembatalan" hanya tampil bila server mengirim `izin.setujuiPembatalan`;
      tombol "Tolak" **tidak ada** (D5)
- [x] Terverifikasi di produksi: `izin.setujuiPembatalan=true` untuk owner, dan endpoint
      menolak dengan pesan jelas saat pesanan bukan pengajuan (HTTP 422)
- [ ] **Uji happy-path** (pesanan benar-benar batal dengan `cancel_by=seller`) menunggu
      ada pengajuan baru — saat verifikasi, satu-satunya pengajuan sudah dibatalkan
      Shopee sendiri (`cancel_by=buyer`) karena melewati tenggat tanggapan
- **Temuan penting:** pengajuan pembatalan pembeli punya tenggat. Kalau owner tidak
  menanggapi, Shopee menyetujuinya sendiri (`cancel_by=buyer`). Karena itu kartu
  "Pembatalan Diajukan" harus ditindaklanjuti hari itu juga.

### Fase 2 — Jejak aktor per tahap (selesai)
- [x] Kolom `pickedById/pickedAt`, `packedById/packedAt`, `handedOverById/handedOverAt`
      + indeks untuk laporan per-orang
- [x] Diisi oleh usecase aksi (picking, packing, handover), bukan hanya audit log
- [x] Dikirim ke UI sebagai `order.aktor` (id + nama) dan ditampilkan di kartu pesanan
- [x] Terverifikasi: migrasi `MIGRATE=0`, kolom terpasang, 344 test lulus
- Catatan: pesanan **lama** tidak punya jejak ini (kolomnya baru) — terisi untuk aksi
  berikutnya, bukan hasil backfill.

### Fase 3 — Ringkasan operasional owner (selesai)
- [x] `GET /api/v1/reports/operations?range=` + `domain/operation-metrics.ts` (7 test)
- [x] Kartu keadaan sekarang: Perlu Produksi · Siap Diambil · Sedang Dipacking · Siap Diserahkan · Gagal
      (angka "diterima kurir Shopee" dipisah karena itu kejadian, bukan keadaan)
- [x] Kejadian dalam rentang: dipacking · diserahkan · diterima kurir Shopee — disaring
      **tanggal kejadian** (packedAt / handedOverAt), bukan tanggal pesanan
- [x] Tabel per pelaku: paket dipacking & diserahkan per orang (D4: jumlah saja, tanpa rupiah)
      + penanda `tanpaNama` untuk data lama agar laporan tidak terlihat lebih rapi dari kenyataan
- [x] Tampil di halaman Laporan (izin `page.reports`), tanpa menu baru
- [x] Terverifikasi produksi: `range=today` → perlu produksi 50 · siap diambil 19 · gagal 10 ·
      diterima kurir Shopee 25; `range=all` → dipacking 166 · diserahkan 166 (semuanya `tanpaNama`,
      karena kolom aktor baru ada)
- Catatan UX: jejak aktor **tidak** ditampilkan di kartu antrean kerja (mengganggu saat
  memproses); tempatnya di halaman Laporan & detail pesanan. Data tetap dikirim API.
- [ ] Tabel jejak per pesanan (timeline) — menyusul bersama Fase 5
- Ukur keberhasilan: angka `hari ini` cocok dengan hitungan manual satu hari kerja.

### Fase 4 — Pemilihan pesanan oleh owner (belum)
- [ ] Daftar "Menunggu dipilih" dengan saran urutan: batas kirim terdekat, stok tersedia, prioritas
- [ ] Aksi "Kerjakan"/"Tunda" (alasan ditunda tercatat + aktor)
- [ ] Pilih massal → masuk antrean kerja; yang belum ada stok otomatis `WAITING_STOCK`
- Selesai bila: owner bisa memilih 20 pesanan sekaligus dan antrean kerja mengikuti.

### Fase 5 — Daftar produksi (PDF) (belum)
- [ ] `GET /api/v1/fulfillment/production-list.pdf?from=&to=` (memakai `pdf-lib`)
- [ ] Isi: nomor pesanan, produk, varian/jilid, qty, batas kirim; dikelompokkan per SKU dengan total
- [ ] "Batch produksi" agar PDF yang dicetak dua kali tidak memicu produksi ganda
- [ ] Kolom tanda tangan tim produksi
- Selesai bila: tim produksi menerima satu lembar untuk satu batch dan statusnya terlacak.

### Fase 6 — Perapian & operasional (sebagian)
- [x] Hapus route `historical-sync` + tombol "Tarik Data Historis"
- [x] Hapus 12 skrip sekali-pakai; sisakan `vps-health.sh` + helper deploy
- [x] Purge binlog + retensi 2 hari (disk 100% → 10%)
- [x] Pisahkan test integrasi dari gate harian
- [ ] `pm2 install pm2-logrotate` (batas 10 MB × 5) + cek disk mingguan
- [ ] Backfill `external_status` **tidak perlu** (0 pesanan aktif tanpa status — terukur)

---

## 6. Aturan kerja (untuk agen & editor)

1. Domain murni di `src/modules/*/domain` — tanpa Prisma, tanpa HTTP; wajib ada test.
2. Usecase memegang transaksi; route hanya memvalidasi input + izin.
3. UI tidak menghitung status/aksi sendiri — server mengirim `workflow`, `stage`,
   `lateRisk`, `cancelCategory`.
4. Setiap aksi yang mengubah data menulis `auditLog` dengan `actorId`.
5. Gate sebelum deploy: `npx tsc --noEmit`, `npm run lint`, `npm run test`,
   `npm run build`. Berat: `npm run test:integration` sebelum rilis.
6. Deploy: `VPS_PASS=... uv run --with paramiko python scripts/vps-deploy-paramiko.py deploy`.
   Jangan memakai `ssh`/`scp` biasa (kunci publik ditolak server).
7. Jangan menambah berkas dokumentasi baru. Perbarui berkas di tabel atas.
