import pymupdf, re

doc = pymupdf.open(r"D:\jhe\E-fullhub\produksi-verifikasi.pdf")
txt = "\n".join(p.get_text() for p in doc)
print("HALAMAN:", len(doc), "| KARAKTER:", len(txt))


def cek(label, ada):
    print(("OK   " if ada else "GAGAL ") + label)


cek('section PALING DEKAT DIBATALKAN OTOMATIS ada', "PALING DEKAT DIBATALKAN OTOMATIS" in txt)
cek('kolom Deadline ada', "Deadline" in txt)
cek('kolom Sisa waktu ada', "Sisa waktu" in txt)
cek('kolom Tanggal TIDAK ada', "Tanggal" not in txt)
cek('tabel Produk/Qty ada', "Produk" in txt and "Qty" in txt)
cek('tanda tangan TIDAK ada', "Diserahkan ke tim produksi" not in txt and
    "Tanggal: ____" not in txt and "__________" not in txt)
cek('batch & jumlah tercetak', "Batch" in txt and "pesanan" in txt)

contoh = re.findall(r"Lewat [^\n|]{0,20}|Sisa [^\n|]{0,22}", txt)[:4]
print("CONTOH SISA WAKTU:", contoh)
print("=== ISI PDF ===")
print(txt[:900])
