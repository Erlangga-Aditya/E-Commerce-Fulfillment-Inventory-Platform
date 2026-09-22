'use client';

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
  RefreshCw, Search, ShoppingBag, Truck, Package,
  ChevronDown, ChevronUp, Printer, RotateCcw, CheckCircle, AlertCircle, Clock, XCircle,
} from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import {
  PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState, Alert, Modal,
} from '@/components/ui';

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface Shop {
  id: string;
  name: string;
  provider: string;
}

// ─── Filter config ────────────────────────────────────────────────────────────

const FILTERS = [
  { key: '', label: 'Semua' },
  { key: 'NEW', label: 'Baru' },
  { key: 'CONFIRMED', label: 'Dikonfirmasi' },
  { key: 'COMPLETED', label: 'Selesai' },
  { key: 'CANCELLED', label: 'Dibatalkan' },
];

// ─── Priority label helper ────────────────────────────────────────────────────

function PriorityIcon({ level }: { level: string | null }) {
  if (!level) return <span className="muted">—</span>;
  const map: Record<string, { icon: React.ReactNode; cls: string }> = {
    CRITICAL: { icon: <AlertCircle size={13} />, cls: 'badge badge-danger' },
    HIGH: { icon: <Clock size={13} />, cls: 'badge badge-warning' },
    MEDIUM: { icon: <CheckCircle size={13} />, cls: 'badge badge-primary' },
    LOW: { icon: <Package size={13} />, cls: 'badge badge-neutral' },
  };
  const m = map[level] ?? { icon: null, cls: 'badge badge-neutral' };
  return (
    <span className={m.cls} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {m.icon}<span>{level}</span>
    </span>
  );
}

// ─── Arrange Shipment Modal ───────────────────────────────────────────────────

interface ArrangeModalState {
  orderId: string;
  orderSn: string;
  shopId: string;
}

function ArrangeShipmentModal({
  state,
  onClose,
  onSuccess,
}: {
  state: ArrangeModalState;
  onClose: () => void;
  onSuccess: (awb: string | null) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usePickup, setUsePickup] = useState(false);
  const [pickupTimeId, setPickupTimeId] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body: Record<string, unknown> = { shopId: state.shopId };
      if (usePickup && pickupTimeId) body.pickupTimeId = pickupTimeId;

      const res = await api<{ success: boolean; trackingNumber: string | null; message?: string }>(
        `/api/v1/orders/${state.orderId}/arrange-shipment`,
        { method: 'POST', body },
      );
      if (!res.success) {
        setError(res.message ?? 'Atur pengiriman gagal.');
      } else {
        onSuccess(res.trackingNumber);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen title={`Atur Pengiriman — ${state.orderSn}`} onClose={onClose}>
      <form onSubmit={submit}>
        <p className="small muted mb16">
          Ini akan memanggil Shopee <code className="mono">logistics/init</code> untuk pesanan ini.
          Setelah berhasil, nomor resi (AWB) akan diterbitkan oleh Shopee secara otomatis.
        </p>

        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={usePickup}
              onChange={(e) => setUsePickup(e.target.checked)}
            />
            <span>Gunakan Pickup (kurir datang jemput)</span>
          </label>
          <p className="small muted mt4">Default: Dropoff — antar sendiri ke dropoff point.</p>
        </div>

        {usePickup && (
          <div className="field">
            <label>Pickup Time ID</label>
            <input
              type="text"
              className="input"
              value={pickupTimeId}
              onChange={(e) => setPickupTimeId(e.target.value)}
              placeholder="Dapatkan dari Shopee: get_timeSlot"
              required
            />
          </div>
        )}

        {error && (
          <div className="mb12">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button type="submit" className="btn btn-primary grow" disabled={loading}>
            <Truck size={14} aria-hidden />
            <span>{loading ? 'Mengatur Pengiriman...' : 'Atur Pengiriman Sekarang'}</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Batal</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Print Label Modal ────────────────────────────────────────────────────────

function PrintLabelModal({
  orderId,
  orderSn,
  shopId,
  onClose,
}: {
  orderId: string;
  orderSn: string;
  shopId: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [labelUrl, setLabelUrl] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function generate() {
    setError('');
    setLoading(true);
    try {
      const res = await api<{ labelUrl: string | null; orderSn: string }>(
        `/api/v1/orders/${orderId}/print-label`,
        { method: 'POST', body: { shopId } },
      );
      if (res.labelUrl) {
        setLabelUrl(res.labelUrl);
        window.open(res.labelUrl, '_blank');
      } else {
        setError('Label belum tersedia dari Shopee. Pastikan pengiriman sudah diatur.');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen title={`Cetak Label — ${orderSn}`} onClose={onClose}>
      <p className="small muted mb16">
        Generate label pengiriman dari Shopee. Label akan terbuka di tab baru untuk dicetak.
      </p>
      {error && <div className="mb12"><Alert tone="danger">{error}</Alert></div>}
      {labelUrl && (
        <div className="mb12">
          <Alert tone="success">
            Label berhasil digenerate.{' '}
            <a href={labelUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
              Klik di sini jika tab baru tidak terbuka.
            </a>
          </Alert>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="btn btn-primary grow" onClick={generate} disabled={loading}>
          <Printer size={14} aria-hidden />
          <span>{loading ? 'Memuat...' : 'Generate & Cetak Label'}</span>
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Tutup</button>
      </div>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PesananPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [filter, setFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const [arrangeModal, setArrangeModal] = useState<ArrangeModalState | null>(null);
  const [printModal, setPrintModal] = useState<{ orderId: string; orderSn: string; shopId: string } | null>(null);
  const shopRef = useRef<Shop | null>(null);

  const load = useCallback(() => {
    Promise.all([
      api<{ items: Order[] }>(`/api/v1/orders${filter ? `?status=${filter}` : ''}`),
      api<Shop[]>('/api/v1/shops'),
    ])
      .then(([d, s]) => {
        setOrders(d.items ?? []);
        setShops(s);
        const shopeeShop = s.find((x) => x.provider === 'shopee') ?? s[0] ?? null;
        shopRef.current = shopeeShop;
      })
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
        setNotice({ tone: 'danger', text: 'Belum ada gudang. Buat gudang terlebih dahulu di menu Pengaturan.' });
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

  const defaultShopId = shopRef.current?.id ?? shops[0]?.id ?? '';

  return (
    <div>
      <PageHeader
        title="Pesanan Marketplace"
        subtitle="Kelola, proses, atur pengiriman, dan cetak label pesanan dari Shopee"
        actions={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => { setLoading(true); setError(''); load(); }}
          >
            <RefreshCw size={14} aria-hidden />
            <span>Muat Ulang</span>
          </button>
        }
      />

      {notice ? (
        <div className="mb16"><Alert tone={notice.tone}>{notice.text}</Alert></div>
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
            placeholder="Cari No. Pesanan / Pembeli / Toko..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <LoadingState message="Memuat daftar pesanan..." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} />
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          title={searchQuery ? 'Pesanan tidak ditemukan' : 'Belum ada pesanan'}
          description={
            searchQuery
              ? `Tidak ada pesanan yang cocok dengan kata kunci "${searchQuery}".`
              : 'Sinkronkan pesanan terbaru melalui menu Integrasi → Sinkronkan Semua.'
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
                <th style={{ textAlign: 'center', minWidth: 200 }}>Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((o) => {
                const isProcessing = processingId === o.id;
                const shopId = defaultShopId;
                const canArrange = o.status === 'CONFIRMED';
                const canProcess = o.status === 'CONFIRMED' && !o.fulfillmentStatus;

                return (
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
                    <td><StatusBadge status={o.status} /></td>
                    <td>
                      {o.fulfillmentStatus
                        ? <StatusBadge status={o.fulfillmentStatus} />
                        : <span className="muted">—</span>}
                    </td>
                    <td><PriorityIcon level={o.priorityLevel} /></td>
                    <td>
                      <span className="small muted">{formatDate(o.shipByAt)}</span>
                    </td>
                    <td className="num">
                      <span style={{ fontWeight: 600 }}>{o.itemCount}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 6 }}>
                        {/* Proses Fulfillment */}
                        {canProcess && (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={isProcessing}
                            onClick={() => processOrder(o.id)}
                          >
                            <Package size={12} aria-hidden />
                            <span>{isProcessing ? 'Memproses...' : 'Proses'}</span>
                          </button>
                        )}

                        {/* Atur Pengiriman */}
                        {canArrange && shopId && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => setArrangeModal({ orderId: o.id, orderSn: o.externalOrderId, shopId })}
                          >
                            <Truck size={12} aria-hidden />
                            <span>Atur Kirim</span>
                          </button>
                        )}

                        {/* Cetak Label */}
                        {canArrange && shopId && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setPrintModal({ orderId: o.id, orderSn: o.externalOrderId, shopId })}
                          >
                            <Printer size={12} aria-hidden />
                            <span>Label</span>
                          </button>
                        )}

                        {/* Done / No action needed */}
                        {!canProcess && !canArrange && (
                          <span className="badge badge-neutral" style={{ opacity: 0.8 }}>
                            {o.status === 'COMPLETED' ? 'Selesai' : o.status === 'CANCELLED' ? 'Dibatalkan' : 'Proses'}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Arrange Shipment Modal */}
      {arrangeModal && (
        <ArrangeShipmentModal
          state={arrangeModal}
          onClose={() => setArrangeModal(null)}
          onSuccess={(awb) => {
            setArrangeModal(null);
            setNotice({
              tone: 'success',
              text: `Pengiriman berhasil diatur!${awb ? ` Nomor resi: ${awb}` : ' Nomor resi akan segera diterbitkan Shopee.'}`,
            });
            load();
          }}
        />
      )}

      {/* Print Label Modal */}
      {printModal && (
        <PrintLabelModal
          orderId={printModal.orderId}
          orderSn={printModal.orderSn}
          shopId={printModal.shopId}
          onClose={() => setPrintModal(null)}
        />
      )}
    </div>
  );
}
