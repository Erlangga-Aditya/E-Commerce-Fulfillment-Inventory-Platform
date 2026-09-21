'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState } from '@/components/ui';

interface Movement {
  id: string;
  movementType: string;
  quantityDelta: number;
  sku: string;
  variantName: string;
  warehouseName: string;
  reason: string | null;
  actorName: string | null;
  createdAt: string;
}
interface Dist { level: string; count: number }

export default function LaporanPage() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [dist, setDist] = useState<Dist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([
      api<{ items: Movement[] }>('/api/v1/inventory/movements?pageSize=50'),
      api<{ priorityDistribution: Dist[] }>('/api/v1/dashboard'),
    ])
      .then(([m, d]) => { setMovements(m.items ?? []); setDist(d.priorityDistribution ?? []); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} />;

  return (
    <div>
      <PageHeader title="Laporan" subtitle="Buku besar pergerakan stok dan prioritas pesanan" />

      <div className="card mb24">
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>Prioritas Pesanan Aktif</h2>
        {dist.length === 0 ? <p className="muted">Belum ada pesanan aktif.</p> : (
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            {dist.map((d) => <div key={d.level} className="row" style={{ gap: 6 }}><StatusBadge status={d.level} /><strong>{d.count}</strong></div>)}
          </div>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ fontSize: 15 }}>Pergerakan Stok (Ledger)</h2>
        <button className="btn btn-secondary btn-sm" onClick={() => { setLoading(true); setError(''); load(); }}><RefreshCw size={14} aria-hidden /> Muat Ulang</button>
      </div>

      {movements.length === 0 ? (
        <EmptyState title="Belum ada pergerakan stok" description="Setiap perubahan stok tercatat di sini." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Waktu</th><th>Jenis</th><th>SKU</th><th>Gudang</th><th className="num">Selisih</th><th>Alasan</th><th>Oleh</th></tr></thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="small">{formatDate(m.createdAt)}</td>
                  <td><StatusBadge status={m.movementType} /></td>
                  <td className="mono">{m.sku}</td>
                  <td>{m.warehouseName}</td>
                  <td className="num" style={{ color: m.quantityDelta < 0 ? 'var(--on-error-container)' : 'var(--on-success-container)', fontWeight: 600 }}>
                    {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                  </td>
                  <td className="small">{m.reason ?? '—'}</td>
                  <td className="small">{m.actorName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
