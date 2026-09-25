'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Pencil, Search, Warehouse, Boxes } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, LoadingState, ErrorState, EmptyState, Alert, Modal } from '@/components/ui';
import { StockPanel } from '@/components/stock-panel';

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
  STOCK_COUNT: 'Stock Opname (Hitung Fisik)',
  DAMAGE: 'Barang Rusak',
  EXPIRY: 'Kedaluwarsa',
  THEFT: 'Barang Hilang / Selisih',
  TRANSFER: 'Transfer Antar Gudang',
  RECEIVING_ERROR: 'Koreksi Penerimaan',
  OTHER: 'Alasan Lainnya',
};

export default function InventoriPage() {
  const [items, setItems] = useState<InvItem[]>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const [stockOpen, setStockOpen] = useState(false);
  const [modal, setModal] = useState<InvItem | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<string>('STOCK_COUNT');
  const [submitting, setSubmitting] = useState(false);

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
    api<Array<{ id: string; name: string }>>('/api/v1/warehouses')
      .then((w) => {
        setWarehouses(w);
        if (w[0]) setWarehouseId(w[0].id);
      })
      .catch(() => undefined);
  }, []);

  useEffect(load, [load]);

  // Realtime auto-update whenever background auto-sync completes
  useEffect(() => {
    const handleSync = () => load();
    window.addEventListener('shopee:synced', handleSync);
    return () => window.removeEventListener('shopee:synced', handleSync);
  }, [load]);

  async function submitAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setNotice(null);
    setSubmitting(true);
    try {
      await api('/api/v1/inventory/adjustments', {
        method: 'POST',
        body: { warehouseId: modal.warehouseId, variantId: modal.variantId, quantityDelta: Number(delta), reason },
      });
      setNotice({ tone: 'success', text: `Stok produk ${modal.sku} berhasil disesuaikan.` });
      setModal(null);
      load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Stok Gudang"
        subtitle="Stok per gudang, pencatatan barang masuk/keluar, dan riwayat perubahan stok"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setStockOpen(true)}>
              <Boxes size={14} aria-hidden />
              <span>Barang Masuk / Kurangi</span>
            </button>
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
          </div>
        }
      />

      <StockPanel
        open={stockOpen}
        onClose={() => setStockOpen(false)}
        warehouseId={warehouseId || null}
        prefillVariantId={null}
        onDone={(message) => {
          setNotice({ tone: 'success', text: message });
          load();
        }}
      />

      {notice ? (
        <div className="mb16">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}

      {/* Responsive Filter Bar */}
      <div className="filter-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 180 }}>
          <Warehouse size={16} style={{ color: 'var(--on-surface-variant)' }} aria-hidden />
          <select
            className="input"
            style={{ width: '100%', maxWidth: 220, height: 38 }}
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>

        <div className="search-input-wrapper">
          <Search size={16} aria-hidden />
          <input
            type="text"
            className="search-input"
            placeholder="Cari SKU / nama produk..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <LoadingState message="Memuat data persediaan gudang..." />
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
          title="Tidak ada data stok produk"
          description="Sinkronkan katalog produk dari Shopee atau lakukan penambahan stok awal."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Produk & Varian</th>
                <th>Barcode</th>
                <th className="num">Stok Fisik (On Hand)</th>
                <th className="num">Ter-Reserve</th>
                <th className="num">Tersedia Dijual</th>
                <th style={{ textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Boxes size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} aria-hidden />
                      <span className="mono" style={{ fontWeight: 700 }}>{it.sku}</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{it.productName}</div>
                    <div className="small muted">{it.variantName}</div>
                  </td>
                  <td>
                    <span className="mono small" style={{ color: it.barcode ? 'var(--on-surface)' : 'var(--on-surface-muted)' }}>
                      {it.barcode ?? '—'}
                    </span>
                  </td>
                  <td className="num">
                    <span style={{ fontWeight: 500 }}>{it.onHand}</span>
                  </td>
                  <td className="num">
                    <span style={{ color: it.reserved > 0 ? 'var(--on-tertiary-container)' : 'var(--on-surface-muted)', fontWeight: it.reserved > 0 ? 600 : 400 }}>
                      {it.reserved}
                    </span>
                  </td>
                  <td className="num">
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        color: it.available > 0 ? 'var(--success)' : 'var(--error)',
                      }}
                    >
                      {it.available}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setModal(it);
                        setDelta('');
                      }}
                    >
                      <Pencil size={12} aria-hidden />
                      <span>Sesuaikan</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Accessible Responsive Adjustment Modal */}
      <Modal isOpen={Boolean(modal)} onClose={() => setModal(null)} title={`Penyesuaian Stok — ${modal?.sku}`}>
        <form onSubmit={submitAdjust}>
          <div className="field">
            <label>Produk Terpilih</label>
            <div style={{ padding: '8px 12px', background: 'var(--surface-low)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
              <strong>{modal?.productName}</strong> ({modal?.variantName}) — Stok saat ini: <strong>{modal?.onHand}</strong> pcs
            </div>
          </div>

          <div className="field">
            <label>Jumlah Selisih (+ atau -)</label>
            <input
              type="number"
              className="input"
              placeholder="Contoh: +5 atau -2"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              required
              autoFocus
            />
            <p className="muted small">Gunakan angka positif untuk menambah stok fisik, atau angka negatif untuk pengurangan.</p>
          </div>

          <div className="field">
            <label>Alasan Penyesuaian (Audit Log)</label>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {REASON_LABEL[r]}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button type="submit" className="btn btn-primary grow" disabled={submitting || !delta}>
              {submitting ? 'Menyimpan...' : 'Simpan Mutasi Stok'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>
              Batal
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
