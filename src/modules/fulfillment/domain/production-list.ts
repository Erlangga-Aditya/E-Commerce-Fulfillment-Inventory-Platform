/**
 * Daftar produksi: pesanan yang barangnya belum ada di gudang.
 *
 * Tiga keputusan yang dikunci di sini (semuanya dari pemilik toko):
 *
 *  1. **Nama pendek.** Nama Shopee sangat panjang ("HADIST SUNAN ABU DAUD
 *     PERJILID DARUL HIKMAH HARD COVER") dan tidak terbaca di lembar kerja.
 *     `namaPendek()` menerjemahkannya menjadi "Abu Daud Jilid 2" dsb.
 *  2. **Urutan: SET lebih dulu**, baru per jilid. Tim produksi mengerjakan
 *     barang jadi (set) lebih dulu, lalu jilid satu per satu.
 *  3. **Isi lembar sesederhana mungkin**: nama produk, qty, tanggal pesanan.
 *     Nomor pesanan tetap disimpan untuk penelusuran, tetapi bukan kolom utama.
 */

export interface BarisProduksi {
  orderId: string;
  externalOrderId: string;
  /** Tanggal pesanan masuk (ISO). */
  placedAt: string;
  /** Batas kirim (ISO) — untuk mengurutkan di dalam grup. */
  shipByAt: string | null;
  sku: string;
  produk: string;
  varian: string | null;
  qty: number;
}

export interface GrupProduksi {
  /** Nama pendek yang tampil di layar & PDF. */
  nama: string;
  /** null = produk set/utuh (tanpa jilid). */
  jilid: number | null;
  totalUnit: number;
  pesanan: BarisProduksi[];
}

export interface DaftarProduksi {
  grup: GrupProduksi[];
  totalPesanan: number;
  totalUnit: number;
}

/** Merek dagang → singkatan yang dipakai tim produksi. */
const MEREK: { cocok: RegExp; nama: string }[] = [
  { cocok: /ABU DAW?UD/, nama: 'Abu Daud' },
  { cocok: /BUKHORI|BUKHARI/, nama: 'Bukhori' },
  { cocok: /SHOHIH MUSLIM|SOHIH MUSLIM|SUNAN MUSLIM|MUSLIM/, nama: 'Muslim' },
  { cocok: /NASAI|NASA[I']I/, nama: 'Nasai' },
  { cocok: /TIRMIDZI|TIRMIDZI/, nama: 'Tirmidzi' },
  { cocok: /IBNU MAJAH|IBNU MAJAH/, nama: 'Ibnu Majah' },
];

const ANGKA_ROMAWI: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };

/** Mengambil nomor jilid dari teks ("Jilid 3", "JILID III", "3", "iii"). */
export function jilidDari(teks: string | null | undefined): number | null {
  if (!teks) return null;
  const bersih = teks.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const angka = bersih.match(/\b(\d{1,2})\b/);
  if (angka) return Number(angka[1]);
  const kata = bersih.split(' ');
  for (const k of kata) if (ANGKA_ROMAWI[k]) return ANGKA_ROMAWI[k];
  return null;
}

function rapikan(kata: string): string {
  return kata
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length <= 2 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * Nama pendek untuk lembar kerja produksi.
 *
 * Contoh hasil (sesuai permintaan pemilik toko):
 *  - "HADIST SUNAN ABU DAUD PERJILID … HARD COVER" + Jilid 1 → "Abu Daud Jilid 1"
 *  - "HADIST SUNAN ABU DAWUD SET …"                         → "Abu Daud Set"
 *  - "HADIST SOHIH BUKHORI … PERJILID …" + Jilid 6          → "Bukhori Jilid 6"
 *  - "HADIST SOHIH BUKHORI … SET 6 JILID, HARDCOVER."       → "Bukhori Set"
 *  - "ALQURAN MAKNA COMBI"                                  → "ALQURAN COMBI"
 *  - "ALQURAN MAKNA POCKET TASIDJAWA"                       → "ALQURAN POCKET"
 */
export function namaPendek(produk: string, varian?: string | null): string {
  const P = produk.toUpperCase();
  const V = (varian ?? '').toUpperCase();
  const gabungan = `${P} ${V}`;

  // Al-Quran: tidak memakai jilid, cukup dibedakan combi/pocket.
  if (P.includes('ALQURAN') || P.includes('AL-QURAN')) {
    if (gabungan.includes('COMBI')) return 'ALQURAN COMBI';
    if (gabungan.includes('POCKET')) return 'ALQURAN POCKET';
    return rapikan(P.replace(/MAKNA/g, ' ').replace(/\s+/g, ' ').trim());
  }

  const merek = MEREK.find((m) => m.cocok.test(P))?.nama;

  // Produk set/utuh: tidak dipecah per jilid.
  const isSet = /\bSET\b/.test(P) && !/PERJILID/.test(P);
  if (isSet) return merek ? `${merek} Set` : rapikan(P);

  const jilid = jilidDari(V) ?? jilidDari(P);
  if (merek) return jilid ? `${merek} Jilid ${jilid}` : merek;

  // Cadangan: buang kata pemasaran, sisakan inti nama.
  const inti = P.replace(/DARUL HIKMAH|HARD ?COVER|PERJILID|HADIST|HADITS|SUNAN|SET \d+ JILID/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const sisaJilid = jilid ?? jilidDari(inti);
  const tanpaAngka = inti.replace(/\b\d+\b/g, ' ').replace(/\bJILID\b/g, ' ').replace(/\s+/g, ' ').trim();
  const nama = rapikan(tanpaAngka || inti);
  return sisaJilid ? `${nama} Jilid ${sisaJilid}` : nama;
}

/** true bila baris ini produk set (tanpa jilid) — dipakai untuk urutan. */
export function isSet(produk: string): boolean {
  const P = produk.toUpperCase();
  return /\bSET\b/.test(P) && !/PERJILID/.test(P);
}

/** Mengelompokkan baris per nama pendek: SET dulu, lalu jilid 1,2,3,… */
export function kelompokkanProduksi(rows: readonly BarisProduksi[]): DaftarProduksi {
  const peta = new Map<string, GrupProduksi>();
  for (const r of rows) {
    const nama = namaPendek(r.produk, r.varian);
    const jilid = isSet(r.produk) ? null : jilidDari(r.varian) ?? jilidDari(r.produk);
    const ada = peta.get(nama);
    if (ada) {
      ada.pesanan.push(r);
      ada.totalUnit += r.qty;
    } else {
      peta.set(nama, { nama, jilid, totalUnit: r.qty, pesanan: [r] });
    }
  }

  const grup = [...peta.values()].sort((a, b) => {
    // 1) SET lebih dulu; 2) jilid menaik; 3) nama sebagai penentu akhir.
    if (a.jilid === null && b.jilid !== null) return -1;
    if (a.jilid !== null && b.jilid === null) return 1;
    if (a.jilid !== null && b.jilid !== null && a.jilid !== b.jilid) return a.jilid - b.jilid;
    return a.nama.localeCompare(b.nama);
  });

  for (const g of grup) {
    g.pesanan.sort((a, b) => {
      const aShip = a.shipByAt ? new Date(a.shipByAt).getTime() : Number.POSITIVE_INFINITY;
      const bShip = b.shipByAt ? new Date(b.shipByAt).getTime() : Number.POSITIVE_INFINITY;
      if (aShip !== bShip) return aShip - bShip;
      return new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime();
    });
  }

  return {
    grup,
    totalPesanan: new Set(rows.map((r) => r.orderId)).size,
    totalUnit: rows.reduce((n, r) => n + r.qty, 0),
  };
}

/**
 * Huruf standar PDF (Helvetica) hanya mendukung Latin-1. Nama produk Shopee
 * sering memuat karakter di luar itu (emoji, tanda kutip melengkung). Tanpa
 * pembersihan, `pdf-lib` melempar error dan PDF gagal dibuat.
 */
export function amanUntukPdf(teks: string): string {
  return teks
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E\n]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
