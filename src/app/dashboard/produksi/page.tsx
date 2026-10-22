"use client";

import { useEffect, useMemo, useState } from 'react';
import { FileDown, Loader2, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/ui';

interface PesananProduksi {
  orderId: string;
  externalOrderId: string;
  tanggal: string;
  batasKirim: string | null;
  qty: number;
  sku: string;
}

interface GrupProduksi {
  nama: string;
  jilid: number | null;
  totalUnit: number;
  pesanan: PesananProduksi[];
}

interface Daftar {
  kodeBatch: string;
  totalPesanan: number;
  totalUnit: number;
  grup: GrupProduksi[];
}

/**
 * Halaman Produksi.
 *
 * Alurnya sengaja satu arah: pilih pesanan → cetak PDF → serahkan ke tim
 * produksi. Tidak ada panel saran yang harus ditafsirkan; urutannya sudah
 * bawaan: produk SET lebih dulu, lalu jilid 1, 2, 3, …
 */
export default function ProduksiPage() {
  const [data, setData] = useState<Daftar | null>(null);
  const [dipilih, setDipilih] = useState<string[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [mencetak, setMencetak] = useState(false);
  const [galat, setGalat] = useState('');
  const [pesan, setPesan] = useState('');

  // Muat sekali saat halaman dibuka. Keadaan hanya diubah setelah `await`
  // (aturan React Compiler: tidak ada setState sinkron di dalam effect), dan
  // hasil yang datang setelah komponen dilepas diabaikan.
  useEffect(() => {
    let dibatalkan = false;
    void (async () => {
      try {
        const res = await api<Daftar>('/api/v1/fulfillment/production-list');
        if (dibatalkan) return;
        setData(res);
        setGalat('');
        setMemuat(false);
      } catch (e) {
        if (dibatalkan) return;
        setGalat((e as Error).message);
        setMemuat(false);
      }
    })();
    return () => {
      dibatalkan = true;
    };
  }, []);

  const semuaId = useMemo(
    () => (data?.grup ?? []).flatMap((g) => g.pesanan.map((p) => p.orderId)),
    [data],
  );

  const toggle = (id: string) =>
    setDipilih((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const toggleGrup = (g: GrupProduksi) => {
    const ids = g.pesanan.map((p) => p.orderId);
    const semuaTerpilih = ids.every((id) => dipilih.includes(id));
    setDipilih((prev) => (semuaTerpilih ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]));
  };

  const cetak = async (hanyaTerpilih: boolean) => {
    setMencetak(true);
    setPesan('');
    try {
      const res = await fetch('/api/v1/fulfillment/production-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: hanyaTerpilih ? dipilih : [] }),
      });
      if (!res.ok) {
        const info = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(info.error?.message ?? `Gagal membuat PDF (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `daftar-produksi-${data?.kodeBatch ?? 'hari-ini'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPesan(`PDF dibuat untuk ${hanyaTerpilih ? dipilih.length : semuaId.length} pesanan.`);
    } catch (e) {
      setPesan((e as Error).message);
    } finally {
      setMencetak(false);
    }
  };

  if (memuat) return <LoadingState message="Memuat daftar produksi..." />;
  if (galat) {
    return (
      <ErrorState
        message={galat}
        onRetry={() => {
          // Muat ulang penuh: kembali ke keadaan "memuat" lalu ambil data lagi.
          window.location.reload();
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Produksi"
        subtitle="Pesanan yang barangnya belum ada. Pilih yang mau dikerjakan, lalu cetak lembar kerja untuk tim produksi."
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={mencetak || semuaId.length === 0}
              onClick={() => void cetak(false)}
            >
              <FileDown size={14} aria-hidden /> Cetak semua ({semuaId.length})
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={mencetak || dipilih.length === 0}
              onClick={() => void cetak(true)}
            >
              {mencetak ? <Loader2 size={14} className="spin" aria-hidden /> : <Printer size={14} aria-hidden />}
              Cetak terpilih ({dipilih.length})
            </button>
          </div>
        }
      />

      {pesan && <p className="small" style={{ margin: '0 0 12px', color: 'var(--info)' }}>{pesan}</p>}

      {!data || data.grup.length === 0 ? (
        <EmptyState title="Tidak ada yang perlu diproduksi" description="Semua pesanan sudah punya stok di gudang." />
      ) : (
        <>
          <div className="chip-row" style={{ marginBottom: 12 }}>
            <span className="chip chip-active">{data.totalPesanan} pesanan</span>
            <span className="chip">{data.totalUnit} unit</span>
            <span className="chip">Batch {data.kodeBatch}</span>
            <button
              type="button"
              className="chip"
              onClick={() => setDipilih(dipilih.length === semuaId.length ? [] : semuaId)}
            >
              {dipilih.length === semuaId.length ? 'Batalkan semua' : 'Pilih semua'}
            </button>
          </div>

          {data.grup.map((g) => (
            <section key={g.nama} className="card" style={{ marginBottom: 12 }}>
              <div className="queue-card-head" style={{ gap: 10, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minWidth: 0 }}>
                  <input
                    type="checkbox"
                    checked={g.pesanan.every((p) => dipilih.includes(p.orderId))}
                    onChange={() => toggleGrup(g)}
                    aria-label={`Pilih semua ${g.nama}`}
                  />
                  <strong style={{ fontSize: 14 }}>{g.nama}</strong>
                </label>
                <span className="small muted">{g.totalUnit} pcs · {g.pesanan.length} pesanan</span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 34 }} />
                      <th>No. Pesanan</th>
                      <th className="num">Qty</th>
                      <th>Tanggal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.pesanan.map((p) => (
                      <tr key={`${p.orderId}-${p.sku}`}>
                        <td>
                          <input
                            type="checkbox"
                            checked={dipilih.includes(p.orderId)}
                            onChange={() => toggle(p.orderId)}
                            aria-label={`Pilih ${p.externalOrderId}`}
                          />
                        </td>
                        <td style={{ fontWeight: 600, wordBreak: 'break-word' }}>{p.externalOrderId}</td>
                        <td className="num">{p.qty}</td>
                        <td className="small muted">{new Date(p.tanggal).toLocaleDateString('id-ID')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
