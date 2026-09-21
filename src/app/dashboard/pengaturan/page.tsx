'use client';

import { useCallback, useEffect, useState } from 'react';
import { Store, Warehouse, ShieldCheck, UserCheck, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState } from '@/components/ui';

interface Me {
  user: { name: string; email: string } | null;
  tenantName: string | null;
  role: string | null;
}

interface WarehouseData {
  id: string;
  name: string;
  code: string;
  status: string;
}

interface ShopData {
  id: string;
  provider: string;
  name: string;
  externalShopId: string | null;
  status: string;
}

export default function PengaturanPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [shops, setShops] = useState<ShopData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([
      api<Me>('/api/v1/auth/me'),
      api<WarehouseData[]>('/api/v1/warehouses'),
      api<ShopData[]>('/api/v1/shops'),
    ])
      .then(([m, w, s]) => {
        setMe(m);
        setWarehouses(w);
        setShops(s);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <LoadingState message="Memuat pengaturan profil workspace..." />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} />;

  return (
    <div>
      <PageHeader
        title="Pengaturan & Profil Workspace"
        subtitle="Informasi penyewa (tenant), daftar gudang fisik, dan saluran toko marketplace terhubung"
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

      {/* Workspace Profile Card */}
      <div className="card mb24">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--on-surface)' }}>
              {me?.tenantName ?? 'Toko Utama'}
            </div>
            <div className="small muted mt8">
              Akun Pengguna: <strong>{me?.user?.name}</strong> ({me?.user?.email})
            </div>
          </div>
          {me?.role ? (
            <span className="badge badge-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', fontSize: 13 }}>
              <UserCheck size={14} aria-hidden />
              <span>Hak Akses: {me.role}</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid-2">
        {/* Warehouses Card */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Warehouse size={18} style={{ color: 'var(--primary)' }} aria-hidden />
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Gudang Fisik Aktif</h2>
          </div>
          {warehouses.length === 0 ? (
            <p className="muted small">Belum ada gudang terdaftar.</p>
          ) : (
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 280 }}>
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Nama Gudang</th>
                    <th style={{ textAlign: 'right' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.map((w) => (
                    <tr key={w.id}>
                      <td className="mono" style={{ fontWeight: 600 }}>{w.code}</td>
                      <td>{w.name}</td>
                      <td style={{ textAlign: 'right' }}>
                        <StatusBadge status={w.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Sales Channels Card */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Store size={18} style={{ color: 'var(--secondary)' }} aria-hidden />
            <h2 style={{ fontSize: 16, fontWeight: 700 }}>Saluran Marketplace</h2>
          </div>
          {shops.length === 0 ? (
            <p className="muted small">Belum ada toko yang terhubung.</p>
          ) : (
            <div className="table-wrap">
              <table className="table" style={{ minWidth: 320 }}>
                <thead>
                  <tr>
                    <th>Nama Toko</th>
                    <th>Platform</th>
                    <th>Shop ID</th>
                    <th style={{ textAlign: 'right' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shops.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td>
                        <span className="badge badge-primary">{s.provider.toUpperCase()}</span>
                      </td>
                      <td className="mono small">{s.externalShopId ?? 'Belum Otorisasi'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <StatusBadge status={s.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Security & Compliance Info Card */}
      <div className="card mt24">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <ShieldCheck size={18} style={{ color: 'var(--success)' }} aria-hidden />
          <h2 style={{ fontSize: 15, fontWeight: 700 }}>Standar Keamanan & Perlindungan Data</h2>
        </div>
        <p className="small muted" style={{ lineHeight: 1.6 }}>
          Sistem ini menerapkan autentikasi sesi berbasis cookie <code className="mono">httpOnly</code> (anti-XSS),
          isolasi data multi-tenant di setiap query, serta enkripsi token <code className="mono">AES-256-GCM</code> at rest.
          Setiap webhook dan sinkronisasi pesanan dilengkapi verifikasi tanda tangan HMAC-SHA256 yang idempoten.
        </p>
      </div>
    </div>
  );
}
