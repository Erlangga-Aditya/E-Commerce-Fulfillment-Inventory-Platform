'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Play, PackageCheck, Truck, Handshake, ScanLine, Clock, CheckCircle2 } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState, Alert } from '@/components/ui';

interface PickItem {
  id: string;
  sku: string;
  variantName: string;
  expectedQuantity: number;
  pickedQuantity: number;
  isConfirmed: boolean;
}

interface FulfillmentItem {
  id: string;
  status: string;
  warehouseName: string;
  order: {
    id: string;
    externalOrderId: string;
    shopName: string;
    buyerName: string | null;
    shipByAt: string | null;
    priorityLevel: string | null;
  };
  pickingTasks: Array<{ id: string; status: string; items: PickItem[] }>;
}

const FILTERS = [
  { key: '', label: 'Semua Aktif' },
  { key: 'WAITING_STOCK', label: 'Menunggu Stok' },
  { key: 'READY_TO_PICK', label: 'Siap Dipick' },
  { key: 'PICKING', label: 'Sedang Dipick' },
  { key: 'PICKED', label: 'Terpick' },
  { key: 'PACKED', label: 'Terkemas' },
  { key: 'READY_TO_SHIP', label: 'Siap Kirim' },
];

export default function FulfillmentPage() {
  const [items, setItems] = useState<FulfillmentItem[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(() => {
    api<{ items: FulfillmentItem[] }>(`/api/v1/fulfillment/queue${filter ? `?status=${filter}` : ''}`)
      .then((d) => setItems(d.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(load, [load]);

  // Realtime auto-update whenever background auto-sync completes
  useEffect(() => {
    const handleSync = () => load();
    window.addEventListener('shopee:synced', handleSync);
    return () => window.removeEventListener('shopee:synced', handleSync);
  }, [load]);

  async function act(id: string, endpoint: string, msg: string, body?: unknown) {
    setNotice(null);
    setActingId(id);
    try {
      await api(endpoint, { method: 'POST', body });
      setNotice({ tone: 'success', text: msg });
      load();
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    } finally {
      setActingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Antrian Fulfillment Gudang"
        subtitle="Alur terpadu: Reservasi → Picking → Packing Barcode → Handover Kurir"
        actions={
          <>
            <Link href="/dashboard/scanner" className="btn btn-primary btn-sm">
              <ScanLine size={14} aria-hidden />
              <span>Buka Scanner</span>
            </Link>
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
          </>
        }
      />

      {/* Filter Bar */}
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
      </div>

      {notice ? (
        <div className="mb16">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}

      {loading ? (
        <LoadingState message="Memuat antrian pekerjaan gudang..." />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            setError('');
            load();
          }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title="Tidak ada pekerjaan fulfillment aktif"
          description={
            filter
              ? `Tidak ada order berstatus "${FILTERS.find((f) => f.key === filter)?.label}".`
              : 'Semua pesanan yang siap diproses telah selesai atau belum ada pesanan baru.'
          }
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 16,
          }}
        >
          {items.map((f) => {
            const task = f.pickingTasks[0];
            const totalPicked = task?.items.reduce((s, i) => s + i.pickedQuantity, 0) ?? 0;
            const totalExpected = task?.items.reduce((s, i) => s + i.expectedQuantity, 0) ?? 0;
            const progressPercent = totalExpected > 0 ? Math.min(100, Math.round((totalPicked / totalExpected) * 100)) : 0;
            const isActing = actingId === f.id;

            return (
              <div key={f.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                    <span className="mono" style={{ fontWeight: 700, fontSize: 14 }}>
                      {f.order.externalOrderId}
                    </span>
                    <StatusBadge status={f.status} />
                  </div>

                  <div className="small muted mb8" style={{ lineHeight: 1.4 }}>
                    <strong>{f.order.buyerName ?? 'Pembeli'}</strong> · {f.order.shopName} · {f.warehouseName}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 8, background: 'var(--surface-low)', padding: '6px 10px', borderRadius: 'var(--r-sm)' }}>
                    <span className="muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={12} aria-hidden /> Batas Kirim
                    </span>
                    <span style={{ fontWeight: 600 }}>{formatDate(f.order.shipByAt)}</span>
                  </div>

                  {f.order.priorityLevel ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 12 }}>
                      <span className="muted">Prioritas</span>
                      <StatusBadge status={f.order.priorityLevel} />
                    </div>
                  ) : null}

                  {task ? (
                    <div style={{ background: 'var(--surface-subtle)', border: '1px solid var(--divider)', borderRadius: 'var(--r-sm)', padding: '10px 12px', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 }}>
                        <span style={{ fontWeight: 600 }}>Progress Picking</span>
                        <span style={{ fontWeight: 700, color: progressPercent === 100 ? 'var(--success)' : 'var(--primary)' }}>
                          {totalPicked} / {totalExpected} item ({progressPercent}%)
                        </span>
                      </div>
                      {/* Visual Progress Bar */}
                      <div style={{ height: 6, width: '100%', background: 'var(--outline-variant)', borderRadius: 9999, overflow: 'hidden', marginBottom: 8 }}>
                        <div style={{ height: '100%', width: `${progressPercent}%`, background: progressPercent === 100 ? 'var(--success)' : 'var(--primary)', transition: 'width 0.3s ease' }} />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {task.items.map((i) => (
                          <div key={i.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                            <span className="mono" style={{ color: 'var(--on-surface-variant)' }}>{i.sku}</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 500 }}>
                              {i.expectedQuantity} pcs
                              {i.isConfirmed ? <CheckCircle2 size={13} style={{ color: 'var(--success)' }} aria-hidden /> : null}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--divider)' }}>
                  {f.status === 'READY_TO_PICK' && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ width: '100%' }}
                      disabled={isActing}
                      onClick={() => act(f.id, `/api/v1/fulfillment/orders/${f.id}/start-picking`, 'Picking dimulai.')}
                    >
                      <Play size={13} aria-hidden />
                      <span>{isActing ? 'Memproses...' : 'Mulai Picking'}</span>
                    </button>
                  )}
                  {f.status === 'PICKING' && (
                    <Link href="/dashboard/scanner" className="btn btn-primary btn-sm" style={{ width: '100%' }}>
                      <ScanLine size={13} aria-hidden />
                      <span>Scan Barcode Item</span>
                    </Link>
                  )}
                  {f.status === 'PICKED' && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ width: '100%' }}
                      disabled={isActing}
                      onClick={() => act(f.id, `/api/v1/fulfillment/orders/${f.id}/pack`, 'Packing berhasil diselesaikan.')}
                    >
                      <PackageCheck size={13} aria-hidden />
                      <span>{isActing ? 'Memproses...' : 'Konfirmasi Selesai Packing'}</span>
                    </button>
                  )}
                  {f.status === 'PACKED' && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ width: '100%' }}
                      disabled={isActing}
                      onClick={() => act(f.id, `/api/v1/fulfillment/orders/${f.id}/ready-to-ship`, 'Status diubah ke Siap Kirim.')}
                    >
                      <Truck size={13} aria-hidden />
                      <span>{isActing ? 'Memproses...' : 'Tandai Siap Kirim'}</span>
                    </button>
                  )}
                  {f.status === 'READY_TO_SHIP' && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ width: '100%' }}
                      disabled={isActing}
                      onClick={() => act(f.id, `/api/v1/fulfillment/orders/${f.id}/handover`, 'Paket diserahkan ke kurir.', {})}
                    >
                      <Handshake size={13} aria-hidden />
                      <span>{isActing ? 'Memproses...' : 'Serah Terima Kurir (Handover)'}</span>
                    </button>
                  )}
                  {f.status === 'WAITING_STOCK' && (
                    <div style={{ fontSize: 12, color: 'var(--on-tertiary-container)', background: 'var(--tertiary-container)', padding: '6px 12px', borderRadius: 'var(--r-sm)', width: '100%', textAlign: 'center', fontWeight: 500 }}>
                      Menunggu penambahan stok di gudang
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
