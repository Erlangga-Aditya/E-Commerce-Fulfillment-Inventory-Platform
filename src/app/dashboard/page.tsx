'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { StatCard, PageHeader, LoadingState, ErrorState, Alert, statusMeta } from '@/components/ui';

interface Metrics {
  ordersDueToday: number;
  ordersLate: number;
  ordersAtRisk: number;
  ordersWaitingStock: number;
  ordersReadyToProcess: number;
  ordersReadyToShip: number;
  returnsWaitingInspection: number;
  pickingInProgress: number;
  ordersCompletedToday: number;
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [dist, setDist] = useState<Array<{ level: string; count: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<{ metrics: Metrics; priorityDistribution: Array<{ level: string; count: number }> }>('/api/v1/dashboard')
      .then((d) => { setMetrics(d.metrics); setDist(d.priorityDistribution ?? []); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} />;
  if (!metrics) return null;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Ringkasan operasional hari ini"
        actions={<button className="btn btn-secondary btn-sm" onClick={() => { setLoading(true); setError(''); load(); }}><RefreshCw size={14} aria-hidden /> Muat Ulang</button>}
      />

      {(metrics.ordersLate > 0 || metrics.ordersAtRisk > 0) && (
        <div className="mb16">
          <Alert tone="danger">
            <strong>{metrics.ordersLate} pesanan terlambat</strong> dan {metrics.ordersAtRisk} berisiko terlambat. Segera proses yang paling mendesak.
          </Alert>
        </div>
      )}

      <div className="stat-grid mb24">
        <StatCard value={metrics.ordersDueToday} label="Harus Dikirim Hari Ini" hint="Batas pengiriman hari ini" tone="warning" href="/dashboard/pesanan" />
        <StatCard value={metrics.ordersLate} label="Pesanan Terlambat" hint="Melewati batas pengiriman" tone="danger" href="/dashboard/pesanan" />
        <StatCard value={metrics.ordersAtRisk} label="Berisiko Terlambat" hint="Batas &lt; 6 jam" tone="warning" href="/dashboard/pesanan" />
        <StatCard value={metrics.ordersWaitingStock} label="Menunggu Stok" hint="Stok belum mencukupi" tone="warning" href="/dashboard/fulfillment" />
        <StatCard value={metrics.ordersReadyToProcess} label="Siap Diproses" hint="Siap picking" tone="secondary" href="/dashboard/fulfillment" />
        <StatCard value={metrics.ordersReadyToShip} label="Siap Dikirim" hint="Menunggu handover kurir" tone="success" href="/dashboard/pengiriman" />
        <StatCard value={metrics.returnsWaitingInspection} label="Retur Perlu QC" hint="Menunggu inspeksi" tone="warning" href="/dashboard/pengembalian" />
        <StatCard value={metrics.ordersCompletedToday} label="Selesai Hari Ini" hint="Berhasil diproses" tone="success" />
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>Distribusi Prioritas Pesanan Aktif</h2>
        {dist.length === 0 ? (
          <p className="muted">Belum ada pesanan aktif dengan prioritas.</p>
        ) : (
          <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
            {dist.map((d) => {
              const m = statusMeta(d.level);
              return (
                <div key={d.level} className="row" style={{ gap: 6 }}>
                  <span className={`badge badge-${m.tone}`}>{m.label}</span>
                  <strong>{d.count}</strong>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
