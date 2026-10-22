'use client';

import { useCallback, useEffect, useState } from 'react';
import { Play, TimerOff, Loader2, FileText } from 'lucide-react';
import { api } from '@/lib/api';

interface Saran {
  orderId: string;
  externalOrderId: string;
  placedAt: string;
  shipByAt: string | null;
  alasan: string;
  sisaJam: number | null;
}

interface HasilSeleksi {
  aksi: 'KERJAKAN' | 'TUNDA';
  diproses: number;
  gagal: { orderId: string; alasan: string }[];
  ditundaSampai?: string;
}

/**
 * Panel saran urutan kerja untuk owner.
 *
 * Urutan datang dari server (`domain/owner-selection.ts`) — UI tidak menyortir
 * sendiri, supaya yang terlihat di layar sama dengan yang dikerjakan.
 */
export function SelectionPanel({ onSelesai }: { onSelesai?: () => void }) {
  const [saran, setSaran] = useState<Saran[]>([]);
  const [dipilih, setDipilih] = useState<string[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<{ tone: 'success' | 'danger' | 'warning'; text: string } | null>(null);

  useEffect(() => {
    let dibatalkan = false;
    void (async () => {
      try {
        const res = await api<{ saran: Saran[] }>('/api/v1/fulfillment/selection?limit=12');
        if (!dibatalkan) setSaran(res.saran ?? []);
      } catch {
        if (!dibatalkan) setSaran([]);
      } finally {
        if (!dibatalkan) setMemuat(false);
      }
    })();
    return () => {
      dibatalkan = true;
    };
  }, []);

  const toggle = useCallback((id: string) => {
    setDipilih((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const kirim = useCallback(
    async (aksi: 'KERJAKAN' | 'TUNDA') => {
      if (dipilih.length === 0) {
        setPesan({ tone: 'warning', text: 'Pilih minimal satu pesanan dulu.' });
        return;
      }
      let alasan: string | null = null;
      if (aksi === 'TUNDA') {
        alasan = window.prompt('Alasan menunda (minimal 8 karakter):', '');
        if (alasan === null) return;
      }

      setSibuk(true);
      setPesan(null);
      try {
        const hasil = await api<HasilSeleksi>('/api/v1/fulfillment/selection', {
          method: 'POST',
          body: { orderIds: dipilih, aksi, ...(alasan ? { alasan } : {}) },
        });
        setPesan({
          tone: hasil.gagal.length > 0 ? 'warning' : 'success',
          text:
            aksi === 'TUNDA'
              ? `${hasil.diproses} pesanan ditunda sampai ${new Date(hasil.ditundaSampai ?? '').toLocaleString('id-ID')}.`
              : `${hasil.diproses} pesanan masuk antrean kerja` +
                (hasil.gagal.length > 0 ? `, ${hasil.gagal.length} gagal (lihat detail).` : '.'),
        });
        setDipilih([]);
        const res = await api<{ saran: Saran[] }>('/api/v1/fulfillment/selection?limit=12');
        setSaran(res.saran ?? []);
        onSelesai?.();
      } catch (e) {
        setPesan({ tone: 'danger', text: (e as Error).message });
      } finally {
        setSibuk(false);
      }
    },
    [dipilih, onSelesai],
  );

  return (
    <section className="card" style={{ marginBottom: 12 }}>
      <div className="queue-card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>Saran urutan kerja</h2>
          <p className="small muted" style={{ margin: '2px 0 0' }}>
            Diurutkan dari batas kirim terdekat. Pilih lalu kerjakan, atau tunda dengan alasan.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="btn btn-secondary btn-sm" href="/api/v1/fulfillment/production-list" title="Daftar barang yang perlu diproduksi (PDF)">
            <FileText size={13} aria-hidden /> Daftar produksi
          </a>
          <button type="button" className="btn btn-primary btn-sm" disabled={sibuk} onClick={() => void kirim('KERJAKAN')}>
            {sibuk ? <Loader2 size={13} className="spin" aria-hidden /> : <Play size={13} aria-hidden />}
            <span>Kerjakan terpilih ({dipilih.length})</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={sibuk} onClick={() => void kirim('TUNDA')}>
            <TimerOff size={13} aria-hidden />
            <span>Tunda 6 jam</span>
          </button>
        </div>
      </div>

      {pesan && (
        <p
          className="small"
          style={{
            margin: '10px 0 0',
            color: pesan.tone === 'danger' ? 'var(--danger)' : pesan.tone === 'warning' ? 'var(--warning)' : 'var(--success)',
          }}
        >
          {pesan.text}
        </p>
      )}

      {memuat ? (
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          <Loader2 size={13} className="spin" aria-hidden /> Memuat saran…
        </p>
      ) : saran.length === 0 ? (
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          Tidak ada pesanan yang menunggu dipilih.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 34 }} />
                <th>No. Pesanan</th>
                <th>Tenggat</th>
                <th>Masuk</th>
              </tr>
            </thead>
            <tbody>
              {saran.map((s) => (
                <tr key={s.orderId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={dipilih.includes(s.orderId)}
                      onChange={() => toggle(s.orderId)}
                      aria-label={`Pilih pesanan ${s.externalOrderId}`}
                    />
                  </td>
                  <td style={{ fontWeight: 600, wordBreak: 'break-word' }}>{s.externalOrderId}</td>
                  <td className="small">{s.alasan}</td>
                  <td className="small muted">{new Date(s.placedAt).toLocaleDateString('id-ID')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
