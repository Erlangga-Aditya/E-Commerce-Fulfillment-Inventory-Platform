'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RefreshCw, Play, PackageCheck, Truck, Handshake, ScanLine } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState, Alert } from '@/components/ui';

interface PickItem { id: string; sku: string; variantName: string; expectedQuantity: number; pickedQuantity: number; isConfirmed: boolean }
interface FulfillmentItem {
  id: string;
  status: string;
  warehouseName: string;
  order: { id: string; externalOrderId: string; shopName: string; buyerName: string | null; shipByAt: string | null; priorityLevel: string | null };
  pickingTasks: Array<{ id: string; status: string; items: PickItem[] }>;
}

const FILTERS = [
  { key: '', label: 'Aktif' },
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(() => {
    api<{ items: FulfillmentItem[] }>(`/api/v1/fulfillment/queue${filter ? `?status=${filter}` : ''}`)
      .then((d) => setItems(d.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(load, [load]);

  async function act(id: string, endpoint: string, msg: string, body?: unknown) {
    setNotice(null);
    try {
      await api(endpoint, { method: 'POST', body });
      setNotice({ tone: 'success', text: msg });
      load();
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    }
  }

  return (
    <div>
      <PageHeader title="Fulfillment" subtitle="Antrian kerja gudang: picking → packing → kirim" />

      <div className="row mb16" style={{ flexWrap: 'wrap', gap: 8 }}>
        {FILTERS.map((f) => (
          <button key={f.key} className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
        <span className="grow" />
        <Link href="/dashboard/scanner" className="btn btn-secondary btn-sm"><ScanLine size={14} aria-hidden /> Buka Scanner</Link>
        <button className="btn btn-secondary btn-sm" onClick={() => { setLoading(true); setError(''); load(); }}><RefreshCw size={14} aria-hidden /> Muat Ulang</button>
      </div>

      {notice ? <div className="mb16"><Alert tone={notice.tone}>{notice.text}</Alert></div> : null}

      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} /> : items.length === 0 ? (
        <EmptyState title="Antrian kosong" description="Tidak ada pekerjaan fulfillment aktif." />
      ) : (
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {items.map((f) => {
            const task = f.pickingTasks[0];
            const totalPicked = task?.items.reduce((s, i) => s + i.pickedQuantity, 0) ?? 0;
            const totalExpected = task?.items.reduce((s, i) => s + i.expectedQuantity, 0) ?? 0;
            return (
              <div key={f.id} className="card">
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                  <span className="mono">{f.order.externalOrderId}</span>
                  <StatusBadge status={f.status} />
                </div>
                <div className="small muted mb8">{f.order.buyerName ?? '—'} · {f.order.shopName} · {f.warehouseName}</div>
                <div className="row small" style={{ justifyContent: 'space-between' }}>
                  <span className="muted">Batas kirim</span>
                  <span>{formatDate(f.order.shipByAt)}</span>
                </div>
                {f.order.priorityLevel ? (
                  <div className="row small mt8" style={{ justifyContent: 'space-between' }}>
                    <span className="muted">Prioritas</span><StatusBadge status={f.order.priorityLevel} />
                  </div>
                ) : null}
                {task ? (
                  <div className="small muted mt8">
                    Pick: <strong>{totalPicked}/{totalExpected}</strong> item
                    {task.items.map((i) => (
                      <div key={i.id} className="mono" style={{ marginTop: 2 }}>{i.sku} × {i.expectedQuantity} {i.isConfirmed ? '✓' : ''}</div>
                    ))}
                  </div>
                ) : null}
                <div className="row mt16" style={{ flexWrap: 'wrap', gap: 6 }}>
                  {f.status === 'READY_TO_PICK' && (
                    <button className="btn btn-primary btn-sm" onClick={() => act(f.id, `/api/v1/fulfillment/orders/${f.id}/start-picking`, 'Picking dimulai.')}><Play size={13} aria-hidden /> Mulai Picking</button>
                  )}
                  {f.status === 'PICKING' && (
                    <Link href="/dashboard/scanner" className="btn btn-primary btn-sm"><ScanLine size={13} aria-hidden /> Scan</Link>
                  )}
                  {f.status === 'PICKED' && (
                    <button className="btn btn-primary btn-sm" onClick={() => act(f.id, `/api/v1/fulfillment/orders/${f.id}/pack`, 'Packing selesai.')}><PackageCheck size={13} aria-hidden /> Selesai Packing</button>
                  )}
                  {f.status === 'PACKED' && (
                    <button className="btn btn-primary btn-sm" onClick={() => act(f.id, `/api/v1/fulfillment/orders/${f.id}/ready-to-ship`, 'Siap dikirim.')}><Truck size={13} aria-hidden /> Siap Kirim</button>
                  )}
                  {f.status === 'READY_TO_SHIP' && (
                    <button className="btn btn-primary btn-sm" onClick={() => act(f.id, `/api/v1/fulfillment/orders/${f.id}/handover`, 'Diserahkan ke kurir.', {})}><Handshake size={13} aria-hidden /> Serahkan</button>
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
