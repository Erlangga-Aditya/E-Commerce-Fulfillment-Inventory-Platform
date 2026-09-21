'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/ui';

interface PickItem { id: string; sku: string; variantName: string; barcode: string | null; expectedQuantity: number; pickedQuantity: number; isConfirmed: boolean }
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
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<{ items: Array<{ id: string; status: string; order: { externalOrderId: string }; pickingTasks: Array<{ id: string; status: string; items: PickItem[] }> }> }>('/api/v1/fulfillment/queue?status=PICKING')
      .then((d) => {
        const mapped: Task[] = (d.items ?? []).flatMap((f) =>
          f.pickingTasks.map((t) => ({ id: t.id, status: f.status, orderExternalId: f.order.externalOrderId, items: t.items })),
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
    if (!selected || !code.trim()) return;
    setResult(null);
    try {
      const res = await api<ScanResp>(`/api/v1/fulfillment/tasks/${selected.id}/scan`, { method: 'POST', body: { scannedCode: code.trim() } });
      setResult(res);
      setCode('');
      if (res.allConfirmed) load();
      inputRef.current?.focus();
    } catch (err) {
      setResult({ success: false, error: { code: 'NETWORK', message: (err as Error).message } });
    }
  }

  return (
    <div>
      <PageHeader title="Scanner" subtitle="Pindai barcode / SKU untuk validasi picking" />

      {loading ? <LoadingState /> : error ? <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} /> : tasks.length === 0 ? (
        <EmptyState title="Tidak ada tugas picking aktif" description="Mulai picking dari menu Fulfillment terlebih dahulu." />
      ) : (
        <div>
          <div className="field" style={{ maxWidth: 360 }}>
            <label>Pilih Tugas Picking</label>
            <select className="input" value={selected?.id ?? ''} onChange={(e) => { setSelected(tasks.find((t) => t.id === e.target.value) ?? null); setResult(null); }}>
              {tasks.map((t) => <option key={t.id} value={t.id}>{t.orderExternalId}</option>)}
            </select>
          </div>

          {selected && (
            <div className="grid-2">
              <div>
                <form onSubmit={scan}>
                  <div className={`scanner-zone ${result?.success ? 'ok' : result?.error ? 'err' : ''}`}>
                    <div className="small muted mb8">Pindai kode lalu tekan Enter</div>
                    <input
                      ref={inputRef}
                      className="input"
                      style={{ height: 48, fontSize: 16, textAlign: 'center' }}
                      placeholder="Scan barcode / SKU..."
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      autoFocus
                    />
                    <button type="submit" className="btn btn-primary mt16" disabled={!code.trim()}>Validasi</button>
                  </div>
                </form>

                {result && (
                  <div className={`alert ${result.success ? 'alert-success' : 'alert-danger'} mt16`}>
                    {result.success ? <CheckCircle2 size={18} aria-hidden /> : <XCircle size={18} aria-hidden />}
                    <div>
                      {result.success
                        ? <>SKU <strong>{result.item?.sku}</strong> cocok — {result.item?.pickedQuantity}/{result.item?.expectedQuantity} terkonfirmasi</>
                        : <>{result.error?.message}</>}
                    </div>
                  </div>
                )}
              </div>

              <div className="card">
                <h2 style={{ fontSize: 15, marginBottom: 12 }}>Item Pesanan — {selected.orderExternalId}</h2>
                <table className="table">
                  <thead><tr><th>SKU</th><th className="num">Butuh</th><th className="num">Terpick</th><th></th></tr></thead>
                  <tbody>
                    {selected.items.map((i) => (
                      <tr key={i.id}>
                        <td className="mono">{i.sku}</td>
                        <td className="num">{i.expectedQuantity}</td>
                        <td className="num">{i.pickedQuantity}</td>
                        <td>{i.isConfirmed ? <CheckCircle2 size={16} style={{ color: 'var(--success)' }} aria-hidden /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn btn-secondary btn-sm mt16" onClick={() => { setLoading(true); setError(''); load(); }}><RefreshCw size={14} aria-hidden /> Muat Ulang</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
