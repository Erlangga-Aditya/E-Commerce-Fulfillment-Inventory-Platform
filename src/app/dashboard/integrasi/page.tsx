'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cable, RefreshCw, Download, PlugZap, ShieldCheck, CircleAlert } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, Alert } from '@/components/ui';

interface Shop { id: string; provider: string; name: string; externalShopId: string | null; status: string }
interface ConnStatus { connected: boolean; status: string; sandbox: boolean; lastSyncAt: string | null; partnerConfigured: boolean; externalShopId: string | null }
interface SyncRun {
  id: string; operation: string; status: string; recordsRead: number; recordsWritten: number;
  startedAt: string; finishedAt: string | null; errorMessage: string | null;
  shop?: { name: string; provider: string };
}

export default function IntegrasiPage() {
  const [shop, setShop] = useState<Shop | null>(null);
  const [status, setStatus] = useState<ConnStatus | null>(null);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [creds, setCreds] = useState({ externalShopId: '', accessToken: '', refreshToken: '' });

  const load = useCallback(() => {
    api<Shop[]>('/api/v1/shops')
      .then(async (shops) => {
        const s = shops.find((x) => x.provider === 'shopee') ?? shops[0] ?? null;
        setShop(s);
        if (s) {
          const [st, r] = await Promise.all([
            api<ConnStatus>(`/api/v1/integrations/shopee/status?shopId=${s.id}`),
            api<SyncRun[]>(`/api/v1/integrations/shopee/sync?shopId=${s.id}`),
          ]);
          setStatus(st);
          setRuns(r);
        } else {
          setStatus(null);
          setRuns([]);
        }
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function startSync() {
    if (!shop) return;
    setSyncing(true);
    setNotice(null);
    try {
      const res = await api<{ message: string; syncRun: { recordsRead: number; recordsWritten: number } }>(`/api/v1/integrations/shopee/sync`, { method: 'POST', body: { shopId: shop.id } });
      setNotice({ tone: 'success', text: `${res.message} (${res.syncRun.recordsWritten} pesanan ditulis).` });
      load();
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  }

  async function startOAuth() {
    if (!shop) return;
    setNotice(null);
    try {
      const { url } = await api<{ url: string }>(`/api/v1/integrations/shopee/auth-url?shopId=${shop.id}`);
      window.location.href = url;
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
    }
  }

  async function submitCreds(e: React.FormEvent) {
    e.preventDefault();
    if (!shop) return;
    setNotice(null);
    try {
      await api('/api/v1/integrations/shopee/connect', { method: 'POST', body: { shopId: shop.id, ...creds } });
      setNotice({ tone: 'success', text: 'Kredensial Shopee tersimpan (terenkripsi).' });
      setShowForm(false);
      load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    }
  }

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} />;

  const connected = status?.connected ?? false;
  const partnerReady = status?.partnerConfigured ?? false;

  return (
    <div>
      <PageHeader
        title="Integrasi Shopee"
        subtitle="Hubungkan toko dan sinkronkan pesanan secara real-time"
        actions={<button className="btn btn-secondary btn-sm" onClick={() => { setLoading(true); setError(''); load(); }}><RefreshCw size={14} aria-hidden /> Muat Ulang</button>}
      />

      {notice ? <div className="mb16"><Alert tone={notice.tone}>{notice.text}</Alert></div> : null}

      {!partnerReady && (
        <div className="mb16"><Alert tone="warning">
          <strong>Kredensial partner belum disetel.</strong> Isi <code className="mono">SHOPEE_PARTNER_ID</code> dan <code className="mono">SHOPEE_PARTNER_KEY</code> di <code className="mono">.env</code> (dari Shopee Open Platform Console). Integrasi akan langsung aktif begitu akun partner Anda disetujui.
        </Alert></div>
      )}

      <div className="stat-grid mb24">
        <div className="card">
          <div className="row mb8"><Cable size={18} style={{ color: 'var(--primary-strong)' }} aria-hidden /><strong>Shopee Indonesia</strong></div>
          <StatusBadge status={connected ? 'ACTIVE' : 'INACTIVE'} />
          <div className="small muted mt8">
            {connected
              ? `Terhubung (${status?.sandbox ? 'Sandbox' : 'Produksi'}) · Shop ${status?.externalShopId ?? '—'}`
              : 'Belum terhubung. Hubungkan untuk mulai sinkronisasi.'}
          </div>
          <div className="small muted mt8">Sinkron terakhir: {formatDate(status?.lastSyncAt)}</div>
        </div>
        <div className="card">
          <div className="row mb8"><PlugZap size={18} style={{ color: 'var(--secondary)' }} aria-hidden /><strong>Status Partner</strong></div>
          <div className="row" style={{ gap: 6 }}><ShieldCheck size={16} style={{ color: partnerReady ? 'var(--success)' : '#9e9e9e' }} aria-hidden />
            <span className="small">{partnerReady ? 'Kredensial partner tersetel' : 'Kredensial partner belum disetel'}</span>
          </div>
          <div className="small muted mt8">Akses token otomatis di-refresh sebelum kedaluwarsa.</div>
        </div>
      </div>

      <div className="card mb24">
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>Hubungkan / Sinkronkan</h2>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button className="btn btn-primary" onClick={startOAuth} disabled={!partnerReady}><Cable size={16} aria-hidden /> Hubungkan via Shopee</button>
          <button className="btn btn-secondary" onClick={() => setShowForm((v) => !v)}>Input Kredensial Manual</button>
          <button className="btn btn-secondary" onClick={startSync} disabled={syncing || !connected}><Download size={16} aria-hidden /> {syncing ? 'Menyinkronkan...' : 'Tarik Pesanan Sekarang'}</button>
        </div>
        {!connected && (
          <div className="small muted mt8"><CircleAlert size={14} style={{ verticalAlign: '-2px' }} aria-hidden /> Sinkronisasi hanya aktif setelah toko terhubung.</div>
        )}
        {showForm && (
          <form onSubmit={submitCreds} style={{ marginTop: 16, maxWidth: 420 }}>
            <div className="field"><label>Shop ID (Shopee)</label><input className="input" value={creds.externalShopId} onChange={(e) => setCreds({ ...creds, externalShopId: e.target.value })} required placeholder="angka shop_id" /></div>
            <div className="field"><label>Access Token</label><input className="input" value={creds.accessToken} onChange={(e) => setCreds({ ...creds, accessToken: e.target.value })} required /></div>
            <div className="field"><label>Refresh Token</label><input className="input" value={creds.refreshToken} onChange={(e) => setCreds({ ...creds, refreshToken: e.target.value })} required /></div>
            <button type="submit" className="btn btn-primary">Simpan Kredensial</button>
          </form>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>Riwayat Sinkronisasi</h2>
        {runs.length === 0 ? (
          <p className="muted">Belum ada riwayat sinkronisasi.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Waktu</th><th>Operasi</th><th className="num">Ditarik</th><th className="num">Ditulis</th><th>Status</th><th>Error</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="small">{formatDate(r.startedAt)}</td>
                    <td className="mono">{r.operation}</td>
                    <td className="num">{r.recordsRead}</td>
                    <td className="num">{r.recordsWritten}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="small">{r.errorMessage ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
