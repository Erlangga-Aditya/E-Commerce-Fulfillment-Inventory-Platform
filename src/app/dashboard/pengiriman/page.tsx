'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState, Alert } from '@/components/ui';

interface Shipment {
  id: string;
  externalOrderId: string;
  shopName: string;
  buyerName: string | null;
  carrier: string | null;
  awb: string | null;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
}

const STATUSES = ['PENDING', 'READY_TO_SHIP', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED'] as const;

export default function PengirimanPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [modal, setModal] = useState<Shipment | null>(null);
  const [ev, setEv] = useState({ status: 'PICKED_UP', carrierStatus: '', description: '' });

  const load = useCallback(() => {
    api<{ items: Shipment[] }>('/api/v1/shipments')
      .then((d) => setShipments(d.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function addEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setNotice(null);
    try {
      await api(`/api/v1/shipments/${modal.id}/events`, { method: 'POST', body: ev });
      setNotice({ tone: 'success', text: 'Event pelacakan ditambahkan.' });
      setModal(null);
      load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    }
  }

  return (
    <div>
      <PageHeader title="Pengiriman" subtitle="Resi dan status pengiriman ke pembeli" />

      {notice ? <div className="mb16"><Alert tone={notice.tone}>{notice.text}</Alert></div> : null}

      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} /> : shipments.length === 0 ? (
        <EmptyState title="Belum ada pengiriman" description="Pengiriman dibuat saat pesanan diserahkan ke kurir." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Resi / AWB</th><th>No. Pesanan</th><th>Pembeli</th><th>Kurir</th><th>Status</th><th>Dikirim</th><th>Terkirim</th><th></th></tr></thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.awb ?? '—'}</td>
                  <td className="mono">{s.externalOrderId}</td>
                  <td>{s.buyerName ?? '—'}</td>
                  <td>{s.carrier ?? '—'}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td className="small">{formatDate(s.shippedAt)}</td>
                  <td className="small">{formatDate(s.deliveredAt)}</td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => { setModal(s); setEv({ status: 'PICKED_UP', carrierStatus: '', description: '' }); }}><Plus size={13} aria-hidden /> Event</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 380 }}>
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>Tambah Event — {modal.awb ?? modal.externalOrderId}</h2>
            <form onSubmit={addEvent}>
              <div className="field">
                <label>Status</label>
                <select className="input" value={ev.status} onChange={(e) => setEv({ ...ev, status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Status Kurir</label>
                <input className="input" value={ev.carrierStatus} onChange={(e) => setEv({ ...ev, carrierStatus: e.target.value })} required placeholder="mis. SHIPPED" />
              </div>
              <div className="field">
                <label>Deskripsi (opsional)</label>
                <input className="input" value={ev.description} onChange={(e) => setEv({ ...ev, description: e.target.value })} />
              </div>
              <div className="row">
                <button type="submit" className="btn btn-primary grow">Simpan</button>
                <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>Batal</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
