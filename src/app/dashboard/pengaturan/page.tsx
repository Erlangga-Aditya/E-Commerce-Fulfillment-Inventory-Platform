'use client';

import { useCallback, useEffect, useState } from 'react';
import { Store, Warehouse, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, LoadingState, ErrorState } from '@/components/ui';

interface Me { user: { name: string; email: string } | null; tenantName: string | null; role: string | null }
interface Warehouse { id: string; name: string; code: string; status: string }
interface Shop { id: string; provider: string; name: string; externalShopId: string | null; status: string }

export default function PengaturanPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    Promise.all([api<Me>('/api/v1/auth/me'), api<Warehouse[]>('/api/v1/warehouses'), api<Shop[]>('/api/v1/shops')])
      .then(([m, w, s]) => { setMe(m); setWarehouses(w); setShops(s); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); setError(''); load(); }} />;

  return (
    <div>
      <PageHeader title="Pengaturan" subtitle="Informasi workspace dan saluran penjualan" />

      <div className="card mb24">
        <h2 style={{ fontSize: 15, marginBottom: 12 }}>Workspace</h2>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{me?.tenantName ?? '—'}</div>
            <div className="small muted">{me?.user?.name} · {me?.user?.email}</div>
          </div>
          {me?.role ? <span className="badge badge-secondary">{me.role}</span> : null}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="row mb12"><Warehouse size={18} style={{ color: 'var(--primary-strong)' }} aria-hidden /><h2 style={{ fontSize: 15 }}>Gudang</h2></div>
          {warehouses.length === 0 ? <p className="muted">Belum ada gudang.</p> : (
            <table className="table">
              <thead><tr><th>Kode</th><th>Nama</th><th>Status</th></tr></thead>
              <tbody>{warehouses.map((w) => <tr key={w.id}><td className="mono">{w.code}</td><td>{w.name}</td><td><StatusBadge status={w.status} /></td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="row mb12"><Store size={18} style={{ color: 'var(--primary-strong)' }} aria-hidden /><h2 style={{ fontSize: 15 }}>Saluran Penjualan</h2></div>
          {shops.length === 0 ? <p className="muted">Belum ada saluran.</p> : (
            <table className="table">
              <thead><tr><th>Nama</th><th>Provider</th><th>Shop ID</th><th>Status</th></tr></thead>
              <tbody>{shops.map((s) => <tr key={s.id}><td>{s.name}</td><td className="mono">{s.provider}</td><td className="mono">{s.externalShopId ?? '—'}</td><td><StatusBadge status={s.status} /></td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card mt24">
        <div className="row"><ShieldCheck size={18} style={{ color: 'var(--secondary)' }} aria-hidden /><h2 style={{ fontSize: 15 }}>Keamanan & Sinkronisasi</h2></div>
        <p className="small muted mt8">
          Sesi login memakai cookie <code className="mono">httpOnly</code>. Kredensial Shopee disimpan terenkripsi
          (AES-256-GCM). Sinkronisasi dan webhook bersifat idempoten agar data tidak duplikat.
        </p>
      </div>
    </div>
  );
}
