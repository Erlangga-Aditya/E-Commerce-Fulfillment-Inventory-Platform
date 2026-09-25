'use client';

import { useCallback, useEffect, useState } from 'react';
import { Boxes, Minus, Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { Alert } from '@/components/ui';

/**
 * Panel Stok Gudang — dipakai bersama oleh halaman "Pesanan & Pengiriman" dan
 * "Stok Gudang" supaya perilakunya persis sama (satu sumber kode, bukan duplikat).
 *
 * Produk diambil otomatis dari toko Shopee (hasil sinkronisasi), bisa ditambah
 * (barang masuk → batch baru) maupun dikurangi (koreksi), dan alokasinya FIFO.
 */
interface StockOption {
  variantId: string;
  productName: string;
  sku: string;
  variantName: string;
  shopName: string | null;
  onHand: number;
  available: number;
  oldestLotAt: string | null;
}

export interface StockPanelProps {
  open: boolean;
  onClose: () => void;
  warehouseId: string | null;
  prefillVariantId: string | null;
  onDone: (message: string) => void;
}

/** Stok Gudang: produk otomatis dari toko Shopee, bisa ditambah maupun dikurangi. */
export function StockPanel({ open, onClose, warehouseId, prefillVariantId, onDone }: StockPanelProps) {
  const [mode, setMode] = useState<'masuk' | 'kurang'>('masuk');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<StockOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<StockOption | null>(null);
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadOptions = useCallback(async (keyword: string) => {
    await Promise.resolve();
    setLoading(true);
    try {
      const res = await api<{ items: StockOption[] }>(
        `/api/v1/inventory/stock-in/options?search=${encodeURIComponent(keyword)}`,
      );
      setOptions(res.items);
      return res.items;
    } catch (e) {
      setError((e as Error).message);
      return [] as StockOption[];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      const list = await loadOptions('');
      if (cancelled || !prefillVariantId) return;
      const found = list.find((o) => o.variantId === prefillVariantId);
      if (found) setSelected(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, prefillVariantId, loadOptions]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (cancelled) return;
      await loadOptions(search);
    })();
    return () => {
      cancelled = true;
    };
  }, [search, open, loadOptions]);

  if (!open) return null;

  async function submit() {
    const qty = Number(quantity);
    if (!selected || !warehouseId) return;
    if (!Number.isInteger(qty) || qty <= 0) {
      setError('Jumlah harus angka bulat lebih dari 0.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'masuk') {
        const res = await api<{ message: string }>('/api/v1/inventory/stock-in', {
          method: 'POST',
          body: {
            warehouseId,
            variantId: selected.variantId,
            quantity: qty,
            notes: notes || undefined,
          },
        });
        onDone(res.message);
      } else {
        await api('/api/v1/inventory/adjustments', {
          method: 'POST',
          body: {
            warehouseId,
            variantId: selected.variantId,
            quantityDelta: -qty,
            reason: 'STOCK_COUNT',
            notes: notes || 'Pengurangan stok dari halaman Pesanan',
          },
        });
        onDone(`Stok ${selected.sku} dikurangi ${qty} unit.`);
      }
      setQuantity('');
      setNotes('');
      const list = await loadOptions(search);
      const updated = list.find((o) => o.variantId === selected.variantId);
      if (updated) setSelected(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mb20">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Boxes size={18} aria-hidden />
            <span>Stok Gudang</span>
          </h2>
          <p className="small muted" style={{ margin: 0, lineHeight: 1.5, maxWidth: 760 }}>
            Daftar produk diambil otomatis dari toko Shopee Anda. Angka stok di Shopee sering diisi asal, jadi
            sistem ini memakai stok gudang sendiri: barang yang <strong>masuk lebih dulu akan keluar lebih dulu</strong>.
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          <span>Tutup</span>
        </button>
      </div>

      <div className="filter-chips" style={{ margin: '12px 0 10px' }}>
        <button
          type="button"
          className={`btn btn-sm ${mode === 'masuk' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('masuk')}
        >
          <Plus size={13} aria-hidden />
          <span>Barang Masuk</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${mode === 'kurang' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setMode('kurang')}
        >
          <Minus size={13} aria-hidden />
          <span>Kurangi / Koreksi</span>
        </button>
      </div>

      <div style={{ position: 'relative', marginBottom: 10 }}>
        <Search
          size={15}
          aria-hidden
          style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}
        />
        <input
          className="input"
          style={{ paddingLeft: 32 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari produk Shopee (nama, kode/SKU, barcode)"
        />
      </div>

      <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Produk Shopee</th>
              <th>Kode</th>
              <th className="num">Stok gudang</th>
              <th style={{ textAlign: 'center' }}>Pilih</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="small muted">Memuat produk dari Shopee...</td>
              </tr>
            )}
            {!loading && options.length === 0 && (
              <tr>
                <td colSpan={4} className="small muted">
                  Produk belum ada. Sinkronkan dulu di menu &quot;Hubungkan Shopee&quot; → tombol &quot;Sinkronkan Produk&quot;.
                </td>
              </tr>
            )}
            {!loading &&
              options.map((o) => (
                <tr key={o.variantId} style={selected?.variantId === o.variantId ? { background: 'var(--surface-low, #f8fafc)' } : undefined}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{o.productName}</div>
                    <div className="small muted">{o.variantName}</div>
                  </td>
                  <td><code className="mono">{o.sku}</code></td>
                  <td className="num">{o.onHand}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelected(o)}>
                      <span>{selected?.variantId === o.variantId ? 'Terpilih' : 'Pilih'}</span>
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div
          style={{
            marginTop: 12,
            border: '1px solid var(--outline-variant, #e2e8f0)',
            borderRadius: 12,
            padding: 14,
            background: 'var(--surface-low, #f8fafc)',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
            {selected.productName} — <code className="mono">{selected.sku}</code> (stok sekarang: {selected.onHand})
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ width: 130 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Jumlah
              </label>
              <input
                className="input"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
              />
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                Catatan (opsional)
              </label>
              <input
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={mode === 'masuk' ? 'Contoh: produksi 23 Sep' : 'Contoh: rusak / salah hitung'}
              />
            </div>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={submit}>
              {mode === 'masuk' ? <Plus size={15} aria-hidden /> : <Minus size={15} aria-hidden />}
              <span>{busy ? 'Menyimpan...' : mode === 'masuk' ? 'Simpan Barang Masuk' : 'Simpan Pengurangan'}</span>
            </button>
          </div>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
      {!warehouseId && <Alert tone="warning">Belum ada gudang aktif. Tambahkan gudang di menu Pengaturan.</Alert>}
    </div>
  );
}
