'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Boxes,
  Workflow,
  ScanLine,
  Truck,
  Undo2,
  ChartColumn,
  Cable,
  Settings,
  LogOut,
  PackageCheck,
} from 'lucide-react';
import { api } from '@/lib/api';

const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard/pesanan', icon: ShoppingCart, label: 'Pesanan' },
  { href: '/dashboard/inventori', icon: Boxes, label: 'Inventori' },
  { href: '/dashboard/fulfillment', icon: Workflow, label: 'Fulfillment' },
  { href: '/dashboard/scanner', icon: ScanLine, label: 'Scanner' },
  { href: '/dashboard/pengiriman', icon: Truck, label: 'Pengiriman' },
  { href: '/dashboard/pengembalian', icon: Undo2, label: 'Pengembalian' },
  { href: '/dashboard/laporan', icon: ChartColumn, label: 'Laporan' },
  { href: '/dashboard/integrasi', icon: Cable, label: 'Integrasi' },
  { href: '/dashboard/pengaturan', icon: Settings, label: 'Pengaturan' },
];

interface Me {
  user: { id: string; name: string; email: string } | null;
  tenantName: string | null;
  role: string | null;
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api<Me>('/api/v1/auth/me').then(setMe).catch(() => setMe(null));
  }, []);

  async function handleLogout() {
    await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.push('/login');
    router.refresh();
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span style={{ display: 'flex', width: 32, height: 32, alignItems: 'center', justifyContent: 'center', background: 'var(--primary)', color: '#fff', borderRadius: 'var(--r-md)' }}>
            <PackageCheck size={18} aria-hidden />
          </span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>E-Fulfill Hub</span>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={`sidebar-link ${active ? 'active' : ''}`}>
                <Icon size={18} strokeWidth={1.75} aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div style={{ padding: 12, borderTop: '1px solid var(--divider)' }}>
          {me?.user ? (
            <div style={{ marginBottom: 8, padding: '0 4px' }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{me.user.name}</div>
              <div className="muted small">{me.tenantName ?? '—'}</div>
            </div>
          ) : null}
          <button onClick={handleLogout} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start' }}>
            <LogOut size={16} aria-hidden />
            Keluar
          </button>
        </div>
      </aside>

      <div className="main-content">
        <header className="topbar">
          <div className="small muted">
            {pathname === '/dashboard' ? 'Ringkasan operasional' : 'E-Fulfill Hub · Terhubung ke Shopee'}
          </div>
          {me?.role ? <span className="badge badge-secondary">{me.role}</span> : null}
        </header>
        <div className="page-body">{children}</div>
      </div>
    </div>
  );
}
