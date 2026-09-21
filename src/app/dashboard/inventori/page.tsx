'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Pencil, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, LoadingState, ErrorState, EmptyState, Alert } from '@/components/ui';

interface InvItem {
  id: string;
  variantId: string;
  warehouseId: string;
  sku: string;
  productName: string;
  variantName: string;
  barcode: string | null;
  onHand: number;
  reserved: number;
  available: number;
}

const REASONS = ['STOCK_COUNT', 'DAMAGE', 'EXPIRY', 'THEFT', 'TRANSFER', 'RECEIVING_ERROR', 'OTHER'] as const;
const REASON_LABEL: Record<string, string> = {
  STOCK_COUNT: 'Stock Opname', DAMAGE: 'Rusak', EXPIRY: 'Kedaluwarsa', THEFT: 'Hilang', TRANSFER: 'Transfer', RECEIVING_ERROR: 'Salah Terima', OTHER: 'Lainnya',
};

export default function InventoriPage() {
  const [items, setItems] = useState<InvItem[]>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const [modal, setModal] = useState<InvItem | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<string>('STOCK_COUNT');

  const load = useCallback(() => {
    const q = new URLSearchParams();
    if (warehouseId) q.set('warehouseId', warehouseId);
    if (search) q.set('search', search);
    api<{ items: InvItem[] }>(`/api/v1/inventory?${q.toString()}`)
      .then((d) => setItems(d.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [warehouseId, search]);

  useEffect(() => {
    api<Array<{ id: string; name: string }>>('/api/v1/warehouses').then((w) => {
      setWarehouses(w);
      if (w[0]) setWarehouseId(w[0].id);
    }).catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  async function submitAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setNotice(null);
    try {
      await api('/api/v1/inventory/adjustments', {
        method: 'POST',
        body: { warehouseId: modal.warehouseId, variantId: modal.variantId, quantityDelta: Number(delta), reason },
      });
      setNotice({ tone: 'success', text: `Stok ${modal.sku} berhasil disesuaikan.` });
      setModal(null);
      load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    }
  }

  return (
    <div>
      <PageHeader title="Inventori" subtitle="Saldo stok per gudang (ledger tersimpan otomatis)" />

      <div className="row mb16" style={{ flexWrap: 'wrap' }}>
        <select className="input" style={{ width: 200 }} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <div className="row grow" style={{ position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 10, color: '#9e9e9e' }} aria-hidden />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="Cari SKU / nama..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => { setLoading(true); setError(''); load(); }}><RefreshCw size={14} aria-hidden /> Muat Ulang</button>
      </div>

      {notice ? <div className="mb16"><Alert tone={notice.tone}>{notice.text}</Alert></div> : null}

      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} /> : items.length === 0 ? (
        <EmptyState title="Tidak ada data stok" description="Sinkronkan produk atau terima stok masuk." />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>SKU</th><th>Produk</th><th>Varian</th><th>Barcode</th><th className="num">On Hand</th><th className="num">Reserved</th><th className="num">Tersedia</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="mono">{it.sku}</td>
                  <td>{it.productName}</td>
                  <td>{it.variantName}</td>
                  <td className="mono">{it.barcode ?? '—'}</td>
                  <td className="num">{it.onHand}</td>
                  <td className="num">{it.reserved}</td>
                  <td className="num"><strong>{it.available}</strong></td>
                  <td><button className="btn btn-ghost btn-sm" onClick={() => { setModal(it); setDelta(''); }}><Pencil size={13} aria-hidden /> Sesuaikan</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div className="card" style={{ width: 380 }}>
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>Sesuaikan Stok — {modal.sku}</h2>
            <form onSubmit={submitAdjust}>
              <div className="field">
                <label>Selisih (+/-)</label>
                <input type="number" className="input" value={delta} onChange={(e) => setDelta(e.target.value)} required />
                <p className="muted small">Positif menambah, negatif mengurangi stok.</p>
              </div>
              <div className="field">
                <label>Alasan</label>
                <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                  {REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
                </select>
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
