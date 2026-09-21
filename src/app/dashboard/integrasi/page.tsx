'use client';

import { useCallback, useEffect, useState } from 'react';
import { Cable, RefreshCw, Download, PlugZap, ShieldCheck, CircleAlert, KeyRound } from 'lucide-react';
import { api, formatDate } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState, Alert } from '@/components/ui';

interface Shop {
  id: string;
  provider: string;
  name: string;
  externalShopId: string | null;
  status: string;
}

interface ConnStatus {
  connected: boolean;
  status: string;
  sandbox: boolean;
  lastSyncAt: string | null;
  partnerConfigured: boolean;
  externalShopId: string | null;
}

interface SyncRun {
  id: string;
  operation: string;
  status: string;
  recordsRead: number;
  recordsWritten: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
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
      const res = await api<{ message: string; syncRun: { recordsRead: number; recordsWritten: number } }>(
        `/api/v1/integrations/shopee/sync`,
        { method: 'POST', body: { shopId: shop.id } },
      );
      setNotice({ tone: 'success', text: `${res.message} (${res.syncRun.recordsWritten} pesanan berhasil ditulis ke database).` });
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
      setNotice({ tone: 'success', text: 'Kredensial Shopee berhasil disimpan dan terenkripsi AES-256.' });
      setShowForm(false);
      load();
    } catch (err) {
      setNotice({ tone: 'danger', text: (err as Error).message });
    }
  }

  if (loading) return <LoadingState message="Memeriksa status koneksi Shopee Open Platform..." />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} />;

  const connected = status?.connected ?? false;
  const partnerReady = status?.partnerConfigured ?? false;

  return (
    <div>
      <PageHeader
        title="Integrasi Shopee Open Platform"
        subtitle="Hubungkan toko Shopee via OAuth 2.0 dan sinkronkan pesanan & stok secara real-time"
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

      {!partnerReady && (
        <div className="mb24">
          <Alert tone="warning">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong>Kredensial Partner Shopee Belum Dikonfigurasi</strong>
              <span>
                Isi parameter <code className="mono">SHOPEE_PARTNER_ID</code> dan <code className="mono">SHOPEE_PARTNER_KEY</code> di file <code className="mono">.env</code> (diperoleh dari Shopee Open Platform Console). Integrasi live akan aktif setelah disetujui.
              </span>
            </div>
          </Alert>
        </div>
      )}

      {/* Connection Status Cards */}
      <div className="stat-grid mb24">
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              <Cable size={18} style={{ color: 'var(--primary)' }} aria-hidden />
              <span>Shopee Marketplace</span>
            </div>
            <StatusBadge status={connected ? 'ACTIVE' : 'INACTIVE'} />
          </div>
          <div className="small muted mb8">
            {connected
              ? `Toko Terhubung (${status?.sandbox ? 'Sandbox Mode' : 'Live Production'}) · ID: ${status?.externalShopId ?? '—'}`
              : 'Belum terhubung. Klik tombol hubungkan untuk mengaktifkan sinkronisasi.'}
          </div>
          <div className="small muted" style={{ borderTop: '1px solid var(--divider)', paddingTop: 8 }}>
            Sinkronisasi Terakhir: <strong>{formatDate(status?.lastSyncAt)}</strong>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              <PlugZap size={18} style={{ color: 'var(--secondary)' }} aria-hidden />
              <span>Status Partner Console</span>
            </div>
            <StatusBadge status={partnerReady ? 'ACTIVE' : 'INACTIVE'} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 8 }}>
            <ShieldCheck size={16} style={{ color: partnerReady ? 'var(--success)' : 'var(--on-surface-muted)' }} aria-hidden />
            <span>{partnerReady ? 'HMAC-SHA256 Signature Siap' : 'Partner Key Kosong di .env'}</span>
          </div>
          <div className="small muted" style={{ borderTop: '1px solid var(--divider)', paddingTop: 8 }}>
            Token akses disegarkan otomatis setiap 4 jam.
          </div>
        </div>
      </div>

      {/* Actions & Synchronization Control */}
      <div className="card mb24">
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Operasi & Sinkronisasi Pesanan</h2>
        <p className="small muted mb16">
          Gunakan OAuth 2.0 resmi untuk menghubungkan toko Anda, atau sinkronkan pesanan baru secara berkala.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={startOAuth}
            disabled={!partnerReady}
          >
            <Cable size={16} aria-hidden />
            <span>Otorisasi Toko via Shopee OAuth</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={startSync}
            disabled={syncing || !connected}
          >
            <Download size={16} aria-hidden />
            <span>{syncing ? 'Menyinkronkan Pesanan...' : 'Tarik Pesanan Terbaru'}</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowForm((v) => !v)}
          >
            <KeyRound size={15} aria-hidden />
            <span>{showForm ? 'Sembunyikan Form Manual' : 'Input Token Manual (Dev)'}</span>
          </button>
        </div>

        {!connected && (
          <div className="small muted mt12" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <CircleAlert size={14} style={{ color: 'var(--tertiary)' }} aria-hidden />
            <span>Tombol penarikan pesanan akan aktif setelah toko berhasil dihubungkan.</span>
          </div>
        )}

        {showForm && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--divider)' }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Input Token Kredensial Manual</h3>
            <form onSubmit={submitCreds} style={{ maxWidth: 480 }}>
              <div className="field">
                <label>External Shop ID (Shopee)</label>
                <input
                  type="text"
                  className="input"
                  value={creds.externalShopId}
                  onChange={(e) => setCreds({ ...creds, externalShopId: e.target.value })}
                  required
                  placeholder="Contoh: 123456789"
                />
              </div>
              <div className="field">
                <label>Access Token (4 Jam)</label>
                <input
                  type="text"
                  className="input mono"
                  value={creds.accessToken}
                  onChange={(e) => setCreds({ ...creds, accessToken: e.target.value })}
                  required
                  placeholder="access_token dari Shopee"
                />
              </div>
              <div className="field">
                <label>Refresh Token (30 Hari, Sekali Pakai)</label>
                <input
                  type="text"
                  className="input mono"
                  value={creds.refreshToken}
                  onChange={(e) => setCreds({ ...creds, refreshToken: e.target.value })}
                  required
                  placeholder="refresh_token dari Shopee"
                />
              </div>
              <button type="submit" className="btn btn-primary">
                Simpan & Enkripsi Kredensial
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Sync Log History */}
      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Riwayat Sinkronisasi (Audit Log)</h2>
        {runs.length === 0 ? (
          <p className="muted small">Belum ada riwayat proses sinkronisasi yang tercatat.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Waktu Eksekusi</th>
                  <th>Operasi</th>
                  <th className="num">Data Dibaca</th>
                  <th className="num">Data Ditulis</th>
                  <th>Status Eksekusi</th>
                  <th>Catatan / Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="small">{formatDate(r.startedAt)}</td>
                    <td>
                      <span className="mono" style={{ fontWeight: 600 }}>{r.operation}</span>
                    </td>
                    <td className="num">{r.recordsRead}</td>
                    <td className="num">
                      <span style={{ fontWeight: 600, color: r.recordsWritten > 0 ? 'var(--success)' : 'inherit' }}>
                        {r.recordsWritten}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="small muted">{r.errorMessage ?? 'Sukses tanpa kendala'}</td>
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
