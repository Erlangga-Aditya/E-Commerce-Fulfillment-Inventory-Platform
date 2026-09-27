#!/usr/bin/env python3
"""Periksa isi label: teks yang tercetak dan gambar yang mungkin barcode.

Dua pertanyaan yang dijawab berkas ini:

1. Apakah nomor resi (AWB) tercetak sebagai TEKS di dalam PDF? Kalau iya,
   operator bisa membacanya dan pemindai bisa memverifikasinya tanpa perlu
   menebak gambar mana yang barcode.
2. Gambar mana yangestructor berbentuk barcode? Jawaban ini dipakai sebagai
   cadangan kalau barcode ternyata gambar dan teksnya tidak terbaca.
"""
from __future__ import annotations

import json
import os
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("pemakaian: tmp-pdflabel.py <berkas-pdf>")
        return 2

    pdf_path = sys.argv[1]
    try:
        import pymupdf
    except ImportError:
        import fitz as pymupdf

    doc = pymupdf.open(pdf_path)
    result = {"pages": [], "text": ""}

    for page_index in range(doc.page_count):
        page = doc.load_page(page_index)
        text = page.get_text("text")
        images = []
        for info in page.get_image_info(xrefs=True):
            w = int(info.get("width", 0))
            h = int(info.get("height", 0))
            if w < 20 or h < 20:
                continue
            images.append({"xref": info.get("xref"), "width": w, "height": h})
        # Kotak yang digambar vektor juga bisa jadi barcode.
        drawings = page.get_drawings()
        result["pages"].append(
            {
                "page": page_index + 1,
                "width": int(page.rect.width),
                "height": int(page.rect.height),
                "text": text,
                "images": images,
                "vector_paths": len(drawings),
            }
        )
        result["text"] += text

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
