'use client';

import { useCallback, useEffect, useState } from 'react';
import { PackageCheck, ClipboardCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState, Alert } from '@/components/ui';

interface RetItem { id: string; sku: string; variantName: string; quantity: number; inspectionResult: string | null }
interface Ret {
  id: string;
  externalReturnId: string | null;
  status: string;
  reason: string | null;
  order: { externalOrderId: string; shopName: string };
  items: RetItem[];
}

const RESULTS = ['SELLABLE', 'DAMAGED', 'PARTIAL', 'REJECTED'] as const;

export default function PengembalianPage() {
  const [returns, setReturns] = useState<Ret[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [qcModal, setQcModal] = useState<Ret | null>(null);
  const [qc, setQc] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    api<{ items: Ret[] }>('/api/v1/returns')
      .then((d) => setReturns(d.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function receive(id: string) {
    setNotice(null);
    try {
      await api(`/api/v1/returns/${id}/receive`, { method: 'POST' });
      setNotice({ tone: 'success', text: 'Paket retur ditandai diterima.' });
      load();
    } catch (e) { setNotice({ tone: 'danger', text: (e as Error).message }); }
  }

  async function submitQc(e: React.FormEvent) {
    e.preventDefault();
    if (!qcModal) return;
    setNotice(null);
    try {
      const warehouses = await api<Array<{ id: string }>>('/api/v1/warehouses');
      const warehouseId = warehouses[0]?.id;
      if (!warehouseId) { setNotice({ tone: 'danger', text: 'Belum ada gudang.' }); return; }
      const items = qcModal.items.map((i) => ({ returnItemId: i.id, result: qc[i.id] ?? 'REJECTED' }));
      await api(`/api/v1/returns/${qcModal.id}/qc`, { method: 'POST', body: { warehouseId, items } });
      setNotice({ tone: 'success', text: 'Hasil QC tersimpan dan stok diperbarui.' });
      setQcModal(null);
      load();
    } catch (e) { setNotice({ tone: 'danger', text: (e as Error).message }); }
  }

  return (
    <div>
      <PageHeader title="Pengembalian" subtitle="Retur dan proses QC (restok / rusak)" />

      {notice ? <div className="mb16"><Alert tone={notice.tone}>{notice.text}</Alert></div> : null}

      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} /> : returns.length === 0 ? (
        <EmptyState title="Belum ada retur" description="Retur masuk dari Shopee via sinkronisasi." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>No. Retur</th><th>No. Pesanan</th><th>Status</th><th>Alasan</th><th className="num">Item</th><th></th></tr></thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.externalReturnId ?? '—'}</td>
                  <td className="mono">{r.order.externalOrderId}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td className="small">{r.reason ?? '—'}</td>
                  <td className="num">{r.items.length}</td>
                  <td>
                    {(r.status === 'REQUESTED' || r.status === 'IN_TRANSIT') && (
                      <button className="btn btn-primary btn-sm" onClick={() => receive(r.id)}><PackageCheck size={13} aria-hidden /> Terima</button>
                    )}
                    {(r.status === 'RECEIVED' || r.status === 'INSPECTION') && (
                      <button className="btn btn-secondary btn-sm" onClick={() => { setQcModal(r); setQc({}); }}><ClipboardCheck size={13} aria-hidden /> QC</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {qcModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 420 }}>
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>Inspeksi QC — {qcModal.externalReturnId ?? qcModal.order.externalOrderId}</h2>
            <form onSubmit={submitQc}>
              {qcModal.items.map((i) => (
                <div key={i.id} className="field">
                  <label>{i.sku} × {i.quantity} — {i.variantName}</label>
                  <select className="input" value={qc[i.id] ?? ''} onChange={(e) => setQc({ ...qc, [i.id]: e.target.value })} required>
                    <option value="" disabled>Pilih hasil...</option>
                    {RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              ))}
              <div className="row">
                <button type="submit" className="btn btn-primary grow">Simpan QC</button>
                <button type="button" className="btn btn-ghost" onClick={() => setQcModal(null)}>Batal</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
