'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { Play, RefreshCw, Search, ShoppingBag } from 'lucide-react';
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
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(() => {
    api<{ items: Order[] }>(`/api/v1/orders${filter ? `?status=${filter}` : ''}`)
      .then((d) => setOrders(d.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(load, [load]);

  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;
    const q = searchQuery.toLowerCase();
    return orders.filter(
      (o) =>
        o.externalOrderId.toLowerCase().includes(q) ||
        (o.buyerName && o.buyerName.toLowerCase().includes(q)) ||
        o.shopName.toLowerCase().includes(q),
    );
  }, [orders, searchQuery]);

  async function processOrder(orderId: string) {
    setNotice(null);
    setProcessingId(orderId);
    try {
      const warehouses = await api<Array<{ id: string }>>('/api/v1/warehouses');
      const warehouseId = warehouses[0]?.id;
      if (!warehouseId) {
        setNotice({ tone: 'danger', text: 'Belum ada gudang. Buat gudang terlebih dahulu.' });
        return;
      }
      const res = await api<{ success: boolean; failedSkus: string[] }>(
        `/api/v1/orders/${orderId}/reserve`,
        { method: 'POST', body: { warehouseId } },
      );
      setNotice(
        res.success
          ? { tone: 'success', text: 'Pesanan berhasil diproses dan masuk ke antrian fulfillment.' }
          : { tone: 'danger', text: `Stok tidak cukup untuk: ${res.failedSkus.join(', ')}` },
      );
      load();
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    } finally {
      setProcessingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Pesanan Marketplace"
        subtitle="Kelola dan proses pesanan yang tersinkronisasi dari Shopee"
        actions={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setLoading(true);
              setError('');
              load();
            }}
          >
            <RefreshCw size={14} aria-hidden />
            <span>Muat Ulang</span>
          </button>
        }
      />

      {notice ? (
        <div className="mb16">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}

      {/* Filter & Search Bar */}
      <div className="filter-bar">
        <div className="filter-chips">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="search-input-wrapper">
          <Search size={16} aria-hidden />
          <input
            type="text"
            className="search-input"
            placeholder="Cari No. Pesanan / Pembeli..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <LoadingState message="Memuat daftar pesanan..." />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            setError('');
            load();
          }}
        />
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          title={searchQuery ? 'Pesanan tidak ditemukan' : 'Belum ada pesanan'}
          description={
            searchQuery
              ? `Tidak ada pesanan yang cocok dengan kata kunci "${searchQuery}".`
              : 'Sinkronkan pesanan terbaru Anda melalui menu Integrasi Shopee.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>No. Pesanan</th>
                <th>Pembeli</th>
                <th>Toko</th>
                <th>Status Pesanan</th>
                <th>Fulfillment</th>
                <th>Prioritas</th>
                <th>Batas Kirim</th>
                <th className="num">Item</th>
                <th style={{ textAlign: 'center' }}>Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ShoppingBag size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} aria-hidden />
                      <span className="mono" style={{ fontWeight: 600 }}>{o.externalOrderId}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{o.buyerName ?? '—'}</div>
                  </td>
                  <td>
                    <span className="badge badge-neutral">{o.shopName}</span>
                  </td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td>
                    {o.fulfillmentStatus ? <StatusBadge status={o.fulfillmentStatus} /> : <span className="muted">—</span>}
                  </td>
                  <td>
                    {o.priorityLevel ? <StatusBadge status={o.priorityLevel} /> : <span className="muted">—</span>}
                  </td>
                  <td>
                    <span className="small muted">{formatDate(o.shipByAt)}</span>
                  </td>
                  <td className="num">
                    <span style={{ fontWeight: 600 }}>{o.itemCount}</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {o.status === 'CONFIRMED' && !o.fulfillmentStatus ? (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={processingId === o.id}
                        onClick={() => processOrder(o.id)}
                      >
                        <Play size={13} aria-hidden />
                        <span>{processingId === o.id ? 'Memproses...' : 'Proses'}</span>
                      </button>
                    ) : (
                      <span className="badge badge-neutral" style={{ opacity: 0.8 }}>Siap</span>
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
