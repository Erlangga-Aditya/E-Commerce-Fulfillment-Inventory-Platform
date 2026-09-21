'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { Plus, Search, Truck, Package, RefreshCw } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState, Alert, Modal } from '@/components/ui';

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

const STATUSES = [
  'PENDING',
  'READY_TO_SHIP',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'FAILED',
  'RETURNED',
] as const;

export default function PengirimanPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [modal, setModal] = useState<Shipment | null>(null);
  const [ev, setEv] = useState({ status: 'PICKED_UP', carrierStatus: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    api<{ items: Shipment[] }>('/api/v1/shipments')
      .then((d) => setShipments(d.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const filteredShipments = useMemo(() => {
    if (!search.trim()) return shipments;
    const q = search.toLowerCase();
    return shipments.filter(
      (s) =>
        (s.awb && s.awb.toLowerCase().includes(q)) ||
        s.externalOrderId.toLowerCase().includes(q) ||
        (s.buyerName && s.buyerName.toLowerCase().includes(q)) ||
        (s.carrier && s.carrier.toLowerCase().includes(q)),
    );
  }, [shipments, search]);

  async function addEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setNotice(null);
    setSubmitting(true);
    try {
      await api(`/api/v1/shipments/${modal.id}/events`, { method: 'POST', body: ev });
      setNotice({ tone: 'success', text: 'Event pelacakan logistik berhasil ditambahkan.' });
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
        title="Pengiriman & Pelacakan Kurir"
        subtitle="Kelola nomor resi (AWB), kurir pengiriman, dan riwayat status pelacakan paket"
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
        <div className="search-input-wrapper">
          <Search size={16} aria-hidden />
          <input
            type="text"
            className="search-input"
            placeholder="Cari No. Resi (AWB), No. Pesanan, Pembeli, Kurir..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <LoadingState message="Memuat daftar pengiriman..." />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            setError('');
            load();
          }}
        />
      ) : filteredShipments.length === 0 ? (
        <EmptyState
          title={search ? 'Pengiriman tidak ditemukan' : 'Belum ada data pengiriman'}
          description={
            search
              ? `Tidak ditemukan pengiriman yang cocok dengan "${search}".`
              : 'Data pengiriman otomatis dibuat saat pesanan diserahkan ke kurir (handover) di menu Fulfillment.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>No. Resi (AWB)</th>
                <th>No. Pesanan</th>
                <th>Pembeli</th>
                <th>Ekspedisi</th>
                <th>Status Pengiriman</th>
                <th>Waktu Kirim</th>
                <th>Waktu Diterima</th>
                <th style={{ textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredShipments.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Truck size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} aria-hidden />
                      <span className="mono" style={{ fontWeight: 700 }}>
                        {s.awb ?? 'Menunggu Resi'}
                      </span>
                    </div>
                  </td>
                  <td className="mono">{s.externalOrderId}</td>
                  <td>{s.buyerName ?? '—'}</td>
                  <td>
                    <span className="badge badge-neutral">{s.carrier ?? 'Reguler'}</span>
                  </td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="small muted">{formatDate(s.shippedAt)}</td>
                  <td className="small muted">{formatDate(s.deliveredAt)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setModal(s);
                        setEv({ status: 'PICKED_UP', carrierStatus: '', description: '' });
                      }}
                    >
                      <Plus size={12} aria-hidden />
                      <span>Update Event</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Accessible Responsive Modal for Tracking Events */}
      <Modal
        isOpen={Boolean(modal)}
        onClose={() => setModal(null)}
        title={`Tambah Event Pelacakan — ${modal?.awb ?? modal?.externalOrderId}`}
      >
        <form onSubmit={addEvent}>
          <div className="field">
            <label>Status Sistem Internal</label>
            <select
              className="input"
              value={ev.status}
              onChange={(e) => setEv({ ...ev, status: e.target.value })}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Status dari Kurir / Ekspedisi</label>
            <input
              type="text"
              className="input"
              value={ev.carrierStatus}
              onChange={(e) => setEv({ ...ev, carrierStatus: e.target.value })}
              required
              placeholder="Contoh: ON_PROCESS / WITH_COURIER / DELIVERED"
            />
          </div>

          <div className="field">
            <label>Catatan / Keterangan Event (Opsional)</label>
            <input
              type="text"
              className="input"
              value={ev.description}
              onChange={(e) => setEv({ ...ev, description: e.target.value })}
              placeholder="Contoh: Paket sedang dibawa kurir menuju alamat penerima"
            />
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button type="submit" className="btn btn-primary grow" disabled={submitting || !ev.carrierStatus}>
              {submitting ? 'Menyimpan...' : 'Simpan Event'}
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
