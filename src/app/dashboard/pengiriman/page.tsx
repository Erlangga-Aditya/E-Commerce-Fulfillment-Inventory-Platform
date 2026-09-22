'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Search,
  Truck,
  Package,
  RefreshCw,
  Printer,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Plus,
  Clock,
  MapPin,
  ExternalLink,
} from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState, Alert, Modal } from '@/components/ui';

interface TrackingEvent {
  id: string;
  status: string;
  description: string | null;
  occurredAt: string;
}

interface Shipment {
  id: string;
  orderId: string;
  externalOrderId: string;
  shopName: string;
  buyerName: string | null;
  carrier: string | null;
  awb: string | null;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  latestEvent: TrackingEvent | null;
}

interface ShipmentDetail extends Shipment {
  events: TrackingEvent[];
}

const STATUS_FILTERS = [
  { label: 'Semua Status', value: 'ALL' },
  { label: 'Menunggu Pengiriman', value: 'PENDING' },
  { label: 'Siap Kirim', value: 'READY_TO_SHIP' },
  { label: 'Diserahkan ke Kurir', value: 'PICKED_UP' },
  { label: 'Dalam Perjalanan', value: 'IN_TRANSIT' },
  { label: 'Terkirim', value: 'DELIVERED' },
  { label: 'Gagal / Retur', value: 'RETURNED' },
] as const;

export default function PengirimanPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  // Expanded row tracking detail
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<Record<string, ShipmentDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Manual Event modal
  const [modal, setModal] = useState<Shipment | null>(null);
  const [ev, setEv] = useState({ status: 'PICKED_UP', carrierStatus: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  // Label printing state
  const [printingOrderId, setPrintingOrderId] = useState<string | null>(null);
  const [labelResult, setLabelResult] = useState<{ url?: string; raw?: string; title: string } | null>(null);

  // Copied AWB indicator
  const [copiedAwb, setCopiedAwb] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ items: Shipment[] }>('/api/v1/shipments')
      .then((d) => setShipments(d.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const filteredShipments = useMemo(() => {
    return shipments.filter((s) => {
      if (statusFilter !== 'ALL' && s.status !== statusFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        (s.awb && s.awb.toLowerCase().includes(q)) ||
        s.externalOrderId.toLowerCase().includes(q) ||
        (s.buyerName && s.buyerName.toLowerCase().includes(q)) ||
        (s.carrier && s.carrier.toLowerCase().includes(q)) ||
        (s.shopName && s.shopName.toLowerCase().includes(q))
      );
    });
  }, [shipments, search, statusFilter]);

  // Expand / collapse shipment row and load full event timeline
  async function toggleExpand(shipment: Shipment) {
    if (expandedId === shipment.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(shipment.id);

    if (!detailData[shipment.id]) {
      setLoadingDetail(true);
      try {
        const detail = await api<ShipmentDetail>(`/api/v1/shipments/${shipment.id}`);
        setDetailData((prev) => ({ ...prev, [shipment.id]: detail }));
      } catch {
        // Fallback: use current row data
        setDetailData((prev) => ({
          ...prev,
          [shipment.id]: {
            ...shipment,
            events: shipment.latestEvent ? [shipment.latestEvent] : [],
          },
        }));
      } finally {
        setLoadingDetail(false);
      }
    }
  }

  function handleCopyAwb(awb: string) {
    navigator.clipboard.writeText(awb);
    setCopiedAwb(awb);
    setTimeout(() => setCopiedAwb(null), 2000);
  }

  async function handlePrintLabel(orderId: string, orderSn: string) {
    setPrintingOrderId(orderId);
    setNotice(null);
    try {
      const res = await api<{
        orderSn: string;
        fileUrl?: string;
        labelBase64?: string;
        status: string;
      }>(`/api/v1/orders/${orderId}/print-label`, {
        method: 'POST',
      });

      if (res.fileUrl) {
        setLabelResult({
          title: `Label Pengiriman — Pesanan ${orderSn}`,
          url: res.fileUrl,
        });
      } else {
        setNotice({
          tone: 'success',
          text: `Dokumen pengiriman pesanan ${orderSn} berhasil digenerate oleh Shopee.`,
        });
      }
    } catch (err) {
      setNotice({
        tone: 'danger',
        text: `Gagal cetak label: ${(err as Error).message}`,
      });
    } finally {
      setPrintingOrderId(null);
    }
  }

  async function addEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setNotice(null);
    setSubmitting(true);
    try {
      await api(`/api/v1/shipments/${modal.id}/events`, { method: 'POST', body: ev });
      setNotice({ tone: 'success', text: 'Event pelacakan logistik berhasil ditambahkan.' });
      setModal(null);
      // Invalidate detail cache for this shipment
      setDetailData((prev) => {
        const copy = { ...prev };
        delete copy[modal.id];
        return copy;
      });
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
        subtitle="Kelola nomor resi (AWB), kurir ekspedisi, cetak label pengiriman, dan riwayat pelacakan real-time"
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

      {notice && (
        <div className="mb16">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      {/* Filter Tabs & Search Bar */}
      <div className="card mb20" style={{ padding: '16px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <div className="search-input-wrapper" style={{ flex: 1, minWidth: 260 }}>
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

        {/* Status Chips */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`btn btn-sm ${statusFilter === f.value ? 'btn-primary' : 'btn-secondary'}`}
              style={{ borderRadius: 20, fontSize: 12, padding: '4px 12px' }}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
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
          title={search || statusFilter !== 'ALL' ? 'Pengiriman tidak ditemukan' : 'Belum ada data pengiriman'}
          description={
            search || statusFilter !== 'ALL'
              ? 'Tidak ditemukan pengiriman yang cocok dengan filter atau kata kunci pencarian.'
              : 'Data pengiriman otomatis disinkronkan saat ada pesanan aktif dengan nomor resi dari Shopee atau setelah dilakukan handover kurir.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>No. Resi (AWB)</th>
                <th>No. Pesanan</th>
                <th>Toko & Pembeli</th>
                <th>Ekspedisi</th>
                <th>Status Terkini</th>
                <th>Waktu Kirim</th>
                <th style={{ textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filteredShipments.map((s) => {
                const isExpanded = expandedId === s.id;
                const detail = detailData[s.id];
                const isPrinting = printingOrderId === s.orderId;

                return (
                  <>
                    <tr key={s.id} style={{ background: isExpanded ? 'var(--subtle)' : undefined }}>
                      <td>
                        <button
                          type="button"
                          className="btn btn-icon btn-sm"
                          title="Lihat Timeline Tracking"
                          onClick={() => toggleExpand(s)}
                          style={{ padding: 4 }}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Truck size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} aria-hidden />
                          <span className="mono" style={{ fontWeight: 700, fontSize: 13 }}>
                            {s.awb ?? 'Menunggu Resi'}
                          </span>
                          {s.awb && (
                            <button
                              type="button"
                              className="btn btn-icon btn-sm"
                              title="Salin Nomor Resi"
                              onClick={() => handleCopyAwb(s.awb!)}
                              style={{ padding: 2, border: 'none', background: 'transparent', cursor: 'pointer' }}
                            >
                              {copiedAwb === s.awb ? (
                                <Check size={13} style={{ color: 'var(--success)' }} />
                              ) : (
                                <Copy size={13} className="muted" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="mono" style={{ fontSize: 12 }}>
                          {s.externalOrderId}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>{s.buyerName ?? '—'}</div>
                        <div className="small muted">{s.shopName}</div>
                      </td>
                      <td>
                        <span className="badge badge-neutral">{s.carrier ?? 'Reguler'}</span>
                      </td>
                      <td>
                        <StatusBadge status={s.status} />
                        {s.latestEvent && (
                          <div
                            className="small muted"
                            style={{
                              marginTop: 4,
                              maxWidth: 220,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={s.latestEvent.description || s.latestEvent.status}
                          >
                            {s.latestEvent.description || s.latestEvent.status}
                          </div>
                        )}
                      </td>
                      <td className="small muted">{formatDate(s.shippedAt || s.createdAt)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={isPrinting}
                            onClick={() => handlePrintLabel(s.orderId, s.externalOrderId)}
                            title="Cetak Dokumen Pengiriman / Label Resi"
                          >
                            <Printer size={13} aria-hidden />
                            <span>{isPrinting ? 'Menyiapkan...' : 'Cetak Label'}</span>
                          </button>

                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setModal(s);
                              setEv({ status: 'PICKED_UP', carrierStatus: '', description: '' });
                            }}
                            title="Tambah status pelacakan secara manual"
                          >
                            <Plus size={13} aria-hidden />
                            <span>Event</span>
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Collapsible Tracking Timeline */}
                    {isExpanded && (
                      <tr key={`${s.id}-timeline`} style={{ background: 'var(--subtle)' }}>
                        <td colSpan={8} style={{ padding: '16px 24px' }}>
                          <div
                            style={{
                              background: 'var(--surface)',
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                              padding: 16,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: 12,
                              }}
                            >
                              <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Clock size={14} style={{ color: 'var(--primary)' }} />
                                Riwayat Perjalanan Paket (Tracking Timeline)
                              </div>
                              <span className="small muted">
                                Kurir: <strong>{s.carrier ?? 'Ekspedisi'}</strong> | Resi: <strong>{s.awb ?? '—'}</strong>
                              </span>
                            </div>

                            {loadingDetail && !detail ? (
                              <div className="small muted" style={{ textAlign: 'center', padding: '12px 0' }}>
                                Memuat riwayat pelacakan kurir...
                              </div>
                            ) : !detail?.events || detail.events.length === 0 ? (
                              <div className="small muted" style={{ textAlign: 'center', padding: '12px 0' }}>
                                Belum ada riwayat event pelacakan logistik untuk nomor resi ini.
                              </div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {detail.events.map((event, idx) => (
                                  <div
                                    key={event.id || idx}
                                    style={{
                                      display: 'flex',
                                      gap: 12,
                                      alignItems: 'flex-start',
                                      position: 'relative',
                                      paddingLeft: 4,
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: '50%',
                                        background: idx === 0 ? 'var(--primary)' : 'var(--border)',
                                        marginTop: 4,
                                        flexShrink: 0,
                                      }}
                                    />
                                    <div style={{ flex: 1 }}>
                                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                        <span style={{ fontWeight: 600, fontSize: 13 }}>
                                          {event.description || event.status}
                                        </span>
                                        <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                                          {event.status}
                                        </span>
                                      </div>
                                      <div className="small muted" style={{ marginTop: 2 }}>
                                        {formatDate(event.occurredAt)}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Cetak Label PDF */}
      <Modal
        isOpen={Boolean(labelResult)}
        onClose={() => setLabelResult(null)}
        title={labelResult?.title ?? 'Label Pengiriman'}
      >
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <Package size={48} style={{ color: 'var(--primary)', margin: '0 auto 16px' }} />
          <p style={{ marginBottom: 20 }}>
            Dokumen label pengiriman siap diunduh atau dicetak. Klik tombol di bawah untuk membuka file PDF:
          </p>
          {labelResult?.url && (
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <a
                href={labelResult.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <ExternalLink size={14} />
                <span>Buka Dokumen PDF</span>
              </a>
              <button type="button" className="btn btn-secondary" onClick={() => setLabelResult(null)}>
                Tutup
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Modal Tambah Event Manual */}
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
              <option value="PICKED_UP">PICKED_UP (Diserahkan ke Kurir)</option>
              <option value="IN_TRANSIT">IN_TRANSIT (Dalam Perjalanan)</option>
              <option value="DELIVERED">DELIVERED (Terkirim ke Pembeli)</option>
              <option value="FAILED">FAILED (Gagal Kirim)</option>
              <option value="RETURNED">RETURNED (Retur ke Penjual)</option>
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
