'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, ScanLine, Barcode, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/ui';

interface PickItem {
  id: string;
  sku: string;
  variantName: string;
  barcode: string | null;
  expectedQuantity: number;
  pickedQuantity: number;
  isConfirmed: boolean;
}

interface Task {
  id: string;
  status: string;
  orderExternalId: string;
  items: PickItem[];
}

interface ScanResp {
  success: boolean;
  item?: PickItem & { pickingItemId: string };
  allConfirmed?: boolean;
  error?: { code: string; message: string };
}

export default function ScannerPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ScanResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<{
      items: Array<{
        id: string;
        status: string;
        order: { externalOrderId: string };
        pickingTasks: Array<{ id: string; status: string; items: PickItem[] }>;
      }>;
    }>('/api/v1/fulfillment/queue?status=PICKING')
      .then((d) => {
        const mapped: Task[] = (d.items ?? []).flatMap((f) =>
          f.pickingTasks.map((t) => ({
            id: t.id,
            status: f.status,
            orderExternalId: f.order.externalOrderId,
            items: t.items,
          })),
        );
        setTasks(mapped);
        setSelected((prev) => mapped.find((m) => m.id === prev?.id) ?? mapped[0] ?? null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function scan(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !code.trim() || validating) return;
    setResult(null);
    setValidating(true);
    try {
      const res = await api<ScanResp>(`/api/v1/fulfillment/tasks/${selected.id}/scan`, {
        method: 'POST',
        body: { scannedCode: code.trim() },
      });
      setResult(res);
      setCode('');
      if (res.allConfirmed) load();
      inputRef.current?.focus();
    } catch (err) {
      setResult({ success: false, error: { code: 'NETWORK', message: (err as Error).message } });
    } finally {
      setValidating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Scanner Barcode Gudang"
        subtitle="Validasi fisik produk secara instan saat proses picking dan packing"
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

      {loading ? (
        <LoadingState message="Memuat tugas pemindaian barcode..." />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            setError('');
            load();
          }}
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="Tidak ada pesanan berstatus Picking"
          description="Buka menu Fulfillment dan klik tombol 'Mulai Picking' pada salah satu pesanan untuk mulai memindai barcode barang."
        />
      ) : (
        <div>
          {/* Order Selector */}
          <div className="card mb16">
            <label style={{ display: 'block', fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--on-surface)' }}>
              Pilih Pesanan yang Sedang Dipick
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <select
                className="input grow"
                style={{ height: 42, fontSize: 14, fontWeight: 500 }}
                value={selected?.id ?? ''}
                onChange={(e) => {
                  setSelected(tasks.find((t) => t.id === e.target.value) ?? null);
                  setResult(null);
                }}
              >
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    Order #{t.orderExternalId} ({t.items.length} jenis item)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selected && (
            <div className="grid-2">
              {/* Scanner Viewport */}
              <div>
                <form onSubmit={scan}>
                  <div
                    className={`scanner-zone ${
                      result?.success ? 'ok' : result?.error ? 'err' : ''
                    }`}
                    style={{ position: 'relative' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                      <span
                        style={{
                          display: 'flex',
                          width: 48,
                          height: 48,
                          borderRadius: '50%',
                          background: result?.success ? 'var(--success-border)' : 'var(--surface-high)',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: result?.success ? 'var(--success)' : 'var(--on-surface-variant)',
                        }}
                      >
                        <Barcode size={24} aria-hidden />
                      </span>
                    </div>

                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, color: 'var(--on-surface)' }}>
                      Scan Barcode / Masukkan SKU
                    </div>
                    <div className="small muted mb16">
                      Arahkan scanner atau ketik barcode/SKU lalu tekan Enter
                    </div>

                    <input
                      ref={inputRef}
                      className="input"
                      style={{
                        height: 52,
                        fontSize: 18,
                        textAlign: 'center',
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        borderWidth: 2,
                      }}
                      placeholder="Contoh: 8991000000001 / KAOS-S"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      autoFocus
                    />

                    <button
                      type="submit"
                      className="btn btn-primary btn-lg mt16"
                      style={{ width: '100%' }}
                      disabled={!code.trim() || validating}
                    >
                      <ScanLine size={18} aria-hidden />
                      <span>{validating ? 'Memvalidasi...' : 'Konfirmasi Pindaian'}</span>
                    </button>
                  </div>
                </form>

                {/* Scan Feedback Banner */}
                {result && (
                  <div
                    className={`alert ${
                      result.success ? 'alert-success' : 'alert-danger'
                    } mt16`}
                    style={{ borderRadius: 'var(--r-md)', padding: 14 }}
                  >
                    {result.success ? (
                      <CheckCircle2 size={22} aria-hidden style={{ color: 'var(--success)' }} />
                    ) : (
                      <XCircle size={22} aria-hidden style={{ color: 'var(--error)' }} />
                    )}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
                        {result.success ? 'Barang Cocok & Terverifikasi' : 'Pindaian Gagal / Tidak Cocok'}
                      </div>
                      <div style={{ fontSize: 13 }}>
                        {result.success ? (
                          <>
                            SKU <strong>{result.item?.sku}</strong> berhasil dicocokkan. Jumlah terverifikasi:{' '}
                            <strong>
                              {result.item?.pickedQuantity}/{result.item?.expectedQuantity} pcs
                            </strong>
                            .
                          </>
                        ) : (
                          result.error?.message
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Order Items Checklist */}
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 700 }}>Daftar Kebutuhan Barang</h2>
                    <div className="small muted">Pesanan #{selected.orderExternalId}</div>
                  </div>
                  <span className="badge badge-primary">
                    {selected.items.filter((i) => i.isConfirmed).length}/{selected.items.length} Selesai
                  </span>
                </div>

                <div className="table-wrap">
                  <table className="table" style={{ minWidth: 320 }}>
                    <thead>
                      <tr>
                        <th>SKU / Varian</th>
                        <th className="num">Kebutuhan</th>
                        <th className="num">Dipindai</th>
                        <th style={{ textAlign: 'center', width: 48 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((i) => (
                        <tr
                          key={i.id}
                          style={{
                            background: i.isConfirmed ? 'var(--success-container)' : undefined,
                          }}
                        >
                          <td>
                            <div className="mono" style={{ fontWeight: 700 }}>{i.sku}</div>
                            <div className="small muted">{i.variantName}</div>
                            {i.barcode ? <div className="small mono muted">{i.barcode}</div> : null}
                          </td>
                          <td className="num">
                            <span style={{ fontWeight: 600 }}>{i.expectedQuantity}</span>
                          </td>
                          <td className="num">
                            <span
                              style={{
                                fontWeight: 700,
                                color: i.isConfirmed ? 'var(--success)' : 'var(--primary)',
                              }}
                            >
                              {i.pickedQuantity}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {i.isConfirmed ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: 24,
                                  height: 24,
                                  borderRadius: '50%',
                                  background: 'var(--success)',
                                  color: '#fff',
                                }}
                              >
                                <Check size={14} strokeWidth={2.5} aria-hidden />
                              </span>
                            ) : (
                              <span style={{ color: 'var(--on-surface-muted)', fontSize: 12 }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
