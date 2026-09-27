#!/usr/bin/env python3
"""Keluarkan setiap gambar yang tertanam di dalam PDF label sebagai berkas PPM.

Barcode label Shopee disimpan sebagai objek gambar di dalam PDF, bukan
sebagai teks. Mengambil gambarnya langsung jauh lebih akurat daripada merender
seluruh halaman lalu menebak bagian mana barcode-nya: yang di-decode hanya
gambar itu sendiri, jadi tidak ada teks, garis tabel, atau logo yang ikut
mengganggu.

PPM dipakai karena Node bisa membacanya tanpa pustaka decode gambar.

Penggunaan:
    uv run --with pymupdf python tmp-pdfimages.py <berkas-pdf>
"""
from __future__ import annotations

import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("pemakaian: tmp-pdfimages.py <berkas-pdf>")
        return 2

    pdf_path = sys.argv[1]
    out_dir = os.path.join(os.path.dirname(pdf_path), "img")
    os.makedirs(out_dir, exist_ok=True)

    try:
        import pymupdf
    except ImportError:
        import fitz as pymupdf

    doc = pymupdf.open(pdf_path)
    images = []
    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        for info in page.get_image_info(xrefs=True):
            xref = info.get("xref")
            if not xref:
                continue
            width = int(info.get("width", 0))
            height = int(info.get("height", 0))
            if width < 20 or height < 20:
                # Ikon kecil atau pixel dekoratif, bukan barcode.
                continue
            try:
                extracted = doc.extract_image(xref)
            except Exception:
                continue
            if not extracted:
                continue
            image = extracted["image"]
            ext = extracted.get("ext", "png")
            path = os.path.join(out_dir, f"p{page_index + 1}-x{xref}.{ext}")
            with open(path, "wb") as fh:
                fh.write(image)
            images.append(
                {
                    "page": page_index + 1,
                    "xref": xref,
                    "width": width,
                    "height": height,
                    "ext": ext,
                    "path": path,
                }
            )

    print(json.dumps({"count": len(images), "images": images}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
