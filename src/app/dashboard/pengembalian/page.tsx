'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { PackageCheck, ClipboardCheck, Search, RefreshCw, Undo2 } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, EmptyState, Alert, Modal } from '@/components/ui';

interface RetItem {
  id: string;
  sku: string;
  variantName: string;
  quantity: number;
  inspectionResult: string | null;
}

interface Ret {
  id: string;
  externalReturnId: string | null;
  status: string;
  reason: string | null;
  order: { externalOrderId: string; shopName: string };
  items: RetItem[];
}

const RESULTS = [
  { key: 'SELLABLE', label: 'Layak Jual (Restok Kembali)' },
  { key: 'DAMAGED', label: 'Rusak / Cacat (Stok Rusak)' },
  { key: 'PARTIAL', label: 'Sebagian Layak' },
  { key: 'REJECTED', label: 'Ditolak (Tidak Direstok)' },
] as const;

export default function PengembalianPage() {
  const [returns, setReturns] = useState<Ret[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [qcModal, setQcModal] = useState<Ret | null>(null);
  const [qc, setQc] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    api<{ items: Ret[] }>('/api/v1/returns')
      .then((d) => setReturns(d.items ?? []))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const filteredReturns = useMemo(() => {
    if (!search.trim()) return returns;
    const q = search.toLowerCase();
    return returns.filter(
      (r) =>
        (r.externalReturnId && r.externalReturnId.toLowerCase().includes(q)) ||
        r.order.externalOrderId.toLowerCase().includes(q) ||
        (r.reason && r.reason.toLowerCase().includes(q)),
    );
  }, [returns, search]);

  async function receive(id: string) {
    setNotice(null);
    try {
      await api(`/api/v1/returns/${id}/receive`, { method: 'POST' });
      setNotice({ tone: 'success', text: 'Paket retur berhasil ditandai diterima di gudang.' });
      load();
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    }
  }

  async function submitQc(e: React.FormEvent) {
    e.preventDefault();
    if (!qcModal) return;
    setNotice(null);
    setSubmitting(true);
    try {
      const warehouses = await api<Array<{ id: string }>>('/api/v1/warehouses');
      const warehouseId = warehouses[0]?.id;
      if (!warehouseId) {
        setNotice({ tone: 'danger', text: 'Belum ada gudang aktif untuk lokasi restok.' });
        return;
      }
      const items = qcModal.items.map((i) => ({ returnItemId: i.id, result: qc[i.id] ?? 'REJECTED' }));
      await api(`/api/v1/returns/${qcModal.id}/qc`, { method: 'POST', body: { warehouseId, items } });
      setNotice({ tone: 'success', text: 'Hasil QC berhasil disimpan dan buku besar mutasi inventori telah diperbarui.' });
      setQcModal(null);
      load();
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Pengembalian Barang (Retur)"
        subtitle="Inspeksi QC paket retur pembeli dan pemulihan stok otomatis ke inventori"
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

      {/* Filter & Search */}
      <div className="filter-bar">
        <div className="search-input-wrapper">
          <Search size={16} aria-hidden />
          <input
            type="text"
            className="search-input"
            placeholder="Cari No. Retur, No. Pesanan, Alasan retur..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <LoadingState message="Memuat daftar pengembalian..." />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            setError('');
            load();
          }}
        />
      ) : filteredReturns.length === 0 ? (
        <EmptyState
          title={search ? 'Data retur tidak ditemukan' : 'Belum ada pengembalian aktif'}
          description={
            search
              ? `Tidak ada data retur yang cocok dengan pencarian "${search}".`
              : 'Data pengembalian barang masuk otomatis dari Shopee via webhook sinkronisasi retur.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>No. Retur</th>
                <th>No. Pesanan</th>
                <th>Status Retur</th>
                <th>Alasan Pengembalian</th>
                <th className="num">Jml Item</th>
                <th style={{ textAlign: 'center' }}>Tindakan QC</th>
              </tr>
            </thead>
            <tbody>
              {filteredReturns.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Undo2 size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} aria-hidden />
                      <span className="mono" style={{ fontWeight: 700 }}>
                        {r.externalReturnId ?? 'Menunggu ID Retur'}
                      </span>
                    </div>
                  </td>
                  <td className="mono">{r.order.externalOrderId}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    <div style={{ maxWidth: 280, fontSize: 13 }} className="muted">
                      {r.reason ?? 'Tidak ada alasan terlampir'}
                    </div>
                  </td>
                  <td className="num">
                    <span style={{ fontWeight: 600 }}>{r.items.length}</span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {(r.status === 'REQUESTED' || r.status === 'IN_TRANSIT') && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => receive(r.id)}
                      >
                        <PackageCheck size={13} aria-hidden />
                        <span>Terima Fisik</span>
                      </button>
                    )}
                    {(r.status === 'RECEIVED' || r.status === 'INSPECTION') && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setQcModal(r);
                          setQc({});
                        }}
                      >
                        <ClipboardCheck size={13} aria-hidden />
                        <span>Inspeksi QC</span>
                      </button>
                    )}
                    {r.status === 'RESTOCKED' && (
                      <span className="badge badge-success">Selesai Restok</span>
                    )}
                    {r.status === 'DAMAGED' && (
                      <span className="badge badge-danger">Barang Rusak</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Accessible QC Inspection Modal */}
      <Modal
        isOpen={Boolean(qcModal)}
        onClose={() => setQcModal(null)}
        title={`Inspeksi QC Retur — ${qcModal?.externalReturnId ?? qcModal?.order.externalOrderId}`}
      >
        <form onSubmit={submitQc}>
          <p className="muted small mb16">
            Tentukan kelayakan fisik setiap barang untuk menentukan apakah stok akan dikembalikan ke saldo inventori atau dicatat sebagai barang rusak.
          </p>

          {qcModal?.items.map((i) => (
            <div key={i.id} className="field mb16">
              <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="mono" style={{ fontWeight: 700 }}>{i.sku}</span>
                <span>{i.quantity} pcs</span>
              </label>
              <div className="small muted mb8">{i.variantName}</div>
              <select
                className="input"
                value={qc[i.id] ?? ''}
                onChange={(e) => setQc({ ...qc, [i.id]: e.target.value })}
                required
              >
                <option value="" disabled>
                  Pilih Hasil Kelayakan QC...
                </option>
                {RESULTS.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button
              type="submit"
              className="btn btn-primary grow"
              disabled={submitting || (qcModal ? Object.keys(qc).length < qcModal.items.length : true)}
            >
              {submitting ? 'Menyimpan...' : 'Simpan Hasil QC & Perbarui Stok'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setQcModal(null)}>
              Batal
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
