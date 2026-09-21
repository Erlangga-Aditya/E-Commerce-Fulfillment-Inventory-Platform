'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Play, RefreshCw } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState, Alert } from '@/components/ui';

interface Order {
  id: string;
  externalOrderId: string;
  status: string;
  fulfillmentStatus: string | null;
  shopName: string;
  buyerName: string | null;
  placedAt: string;
  shipByAt: string | null;
  priorityLevel: string | null;
  itemCount: number;
}

const FILTERS = [
  { key: '', label: 'Semua' },
  { key: 'NEW', label: 'Baru' },
  { key: 'CONFIRMED', label: 'Dikonfirmasi' },
  { key: 'COMPLETED', label: 'Selesai' },
  { key: 'CANCELLED', label: 'Dibatalkan' },
];

export default function PesananPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(() => {
    api<{ items: Order[] }>(`/api/v1/orders${filter ? `?status=${filter}` : ''}`)
      .then((d) => setOrders(d.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(load, [load]);

  async function processOrder(orderId: string) {
    setNotice(null);
    try {
      const warehouses = await api<Array<{ id: string }>>('/api/v1/warehouses');
      const warehouseId = warehouses[0]?.id;
      if (!warehouseId) { setNotice({ tone: 'danger', text: 'Belum ada gudang. Buat gudang terlebih dahulu.' }); return; }
      const res = await api<{ success: boolean; failedSkus: string[] }>(`/api/v1/orders/${orderId}/reserve`, { method: 'POST', body: { warehouseId } });
      setNotice(res.success
        ? { tone: 'success', text: 'Pesanan diproses dan masuk antrian fulfillment.' }
        : { tone: 'danger', text: `Stok tidak cukup untuk: ${res.failedSkus.join(', ')}` });
      load();
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    }
  }

  return (
    <div>
      <PageHeader title="Pesanan" subtitle="Semua pesanan yang disinkronkan dari Shopee" />

      <div className="row mb16" style={{ flexWrap: 'wrap', gap: 8 }}>
        {FILTERS.map((f) => (
          <button key={f.key} className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
        <span className="grow" />
        <button className="btn btn-secondary btn-sm" onClick={() => { setLoading(true); setError(''); load(); }}><RefreshCw size={14} aria-hidden /> Muat Ulang</button>
      </div>

      {notice ? <div className="mb16"><Alert tone={notice.tone}>{notice.text}</Alert></div> : null}

      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} /> : orders.length === 0 ? (
        <EmptyState title="Belum ada pesanan" description="Sinkronkan pesanan dari menu Integrasi." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>No. Pesanan</th><th>Pembeli</th><th>Toko</th><th>Status</th><th>Fulfillment</th><th>Prioritas</th><th>Batas Kirim</th><th className="num">Item</th><th></th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.externalOrderId}</td>
                  <td>{o.buyerName ?? '—'}</td>
                  <td>{o.shopName}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td>{o.fulfillmentStatus ? <StatusBadge status={o.fulfillmentStatus} /> : '—'}</td>
                  <td>{o.priorityLevel ? <StatusBadge status={o.priorityLevel} /> : '—'}</td>
                  <td className="small">{formatDate(o.shipByAt)}</td>
                  <td className="num">{o.itemCount}</td>
                  <td>
                    {o.status === 'CONFIRMED' && !o.fulfillmentStatus ? (
                      <button className="btn btn-primary btn-sm" onClick={() => processOrder(o.id)}><Play size={13} aria-hidden /> Proses</button>
                    ) : (
                      <Link href={`/dashboard/pesanan`} className="btn btn-ghost btn-sm">Detail</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
