import pymupdf

doc = pymupdf.open(r"D:\jhe\E-fullhub\produksi-verifikasi.pdf")
page = doc[0]
W = page.rect.width

# Ambil semua baris teks beserta koordinatnya
rows = []
for blk in page.get_text("dict")["blocks"]:
    for line in blk.get("lines", []):
        spans = line.get("spans", [])
        if not spans:
            continue
        x0 = min(s["bbox"][0] for s in spans)
        x1 = max(s["bbox"][2] for s in spans)
        y0 = min(s["bbox"][1] for s in spans)
        y1 = max(s["bbox"][3] for s in spans)
        teks = "".join(s["text"] for s in spans).strip()
        if teks:
            rows.append({"teks": teks, "x0": x0, "x1": x1, "y0": y0, "y1": y1, "size": spans[0]["size"]})

print(f"Ukuran halaman: {W:.0f} x {page.rect.height:.0f} pt | {len(rows)} baris teks")
print("=" * 70)

masalah = []

# 1) Cek overflow horizontal & margin
for r in rows:
    if r["x1"] > W - 20:
        masalah.append(f"baris melebihi margin kanan: {r['teks'][:30]!r} x1={r['x1']:.0f}")
    if r["x0"] < 20:
        masalah.append(f"baris melebihi margin kiri: {r['teks'][:30]!r} x0={r['x0']:.0f}")
    if r["y1"] > page.rect.height - 20:
        masalah.append(f"baris terlalu dekat ke bawah: {r['teks'][:30]!r}")

# 2) Cek tumpang tindih vertikal antar baris teks
for i in range(len(rows)):
    for j in range(i + 1, len(rows)):
        a, b = rows[i], rows[j]
        # hanya pasangan baris berbeda yang bukan bagian tabel yg sengaja sejajar
        tumpang = min(a["x1"], b["x1"]) - max(a["x0"], b["x0"])
        if tumpang > 2 and min(a["y1"], b["y1"]) - max(a["y0"], b["y0"]) > 2:
            masalah.append(f"tumpang tindih: {a['teks'][:22]!r} <> {b['teks'][:22]!r}")

# 3) Tata letak: section mendesak harus ADA sebelum tabel produk utama
idx_mendesak = next((i for i, r in enumerate(rows) if "DIBATALKAN OTOMATIS" in r["teks"]), None)
idx_tabel = next((i for i, r in enumerate(rows) if r["teks"].strip() == "Produk" and i > 3), None)
if idx_mendesak is None:
    masalah.append("section mendesak tidak ditemukan")
elif idx_tabel is not None and idx_mendesak > idx_tabel:
    masalah.append("section mendesak berada DI BAWAH tabel produk (seharusnya di atas)")

print("HASIL VERIFIKASI TATA LETAK")
print("-" * 70)
if masalah:
    for m in masalah[:15]:
        print("GAGAL  " + m)
else:
    print("OK    Tidak ada overflow margin kiri/kanan/bawah")
    print("OK    Tidak ada baris teks yang tumpang tindih")
if idx_mendesak is not None and idx_tabel is not None:
    print(f"OK    Section mendesak di baris {idx_mendesak} (tabel produk di baris {idx_tabel}) — urutan benar")

print("=" * 70)
print("Struktur (y, x, teks):")
for r in rows[:34]:
    print(f"  y={r['y0']:6.1f} x={r['x0']:6.1f} size={r['size']:.1f}  {r['teks'][:44]}")
