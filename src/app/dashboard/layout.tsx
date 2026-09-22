'use client';

import { type ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
  Package,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  UserCheck,
} from 'lucide-react';
import { api } from '@/lib/api';

const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/dashboard/pesanan', icon: ShoppingCart, label: 'Pesanan' },
  { href: '/dashboard/produk', icon: Package, label: 'Produk' },
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
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);

  // Close mobile drawer on route change
  useEffect(() => {
    setIsMobileNavOpen(false);
  }, [pathname]);

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (isMobileNavOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileNavOpen]);

  useEffect(() => {
    api<Me>('/api/v1/auth/me').then(setMe).catch(() => setMe(null));
  }, []);

  async function handleLogout() {
    await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    router.push('/login');
    router.refresh();
  }

  // Get readable current page context for topbar
  const currentItem = NAV_ITEMS.find(
    (item) => pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href)),
  );
  const currentPageTitle = currentItem ? currentItem.label : 'E-Fulfill Hub';

  return (
    <div className="dashboard-root">
      {/* Mobile Drawer Overlay Backdrop */}
      <div
        className={`sidebar-overlay ${isMobileNavOpen ? 'active' : ''}`}
        onClick={() => setIsMobileNavOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar Navigation */}
      <aside
        className={`sidebar ${isMobileNavOpen ? 'mobile-open' : ''} ${isDesktopCollapsed ? 'collapsed' : ''}`}
        aria-label="Navigasi Utama"
      >
        <div className="sidebar-brand">
          <Link href="/dashboard" className="sidebar-brand-content">
            <span className="sidebar-brand-logo">
              <PackageCheck size={20} aria-hidden />
            </span>
            <span className="sidebar-brand-title">E-Fulfill Hub</span>
          </Link>
          <button
            type="button"
            className="sidebar-close-btn"
            onClick={() => setIsMobileNavOpen(false)}
            aria-label="Tutup menu navigasi"
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${active ? 'active' : ''}`}
                title={isDesktopCollapsed ? item.label : undefined}
                onClick={() => setIsMobileNavOpen(false)}
              >
                <Icon size={19} strokeWidth={active ? 2.2 : 1.75} aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {me?.user ? (
            <div className="mb12 user-info-text">
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--on-surface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {me.user.name}
              </div>
              <div className="muted small" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {me.tenantName ?? 'Toko Utama'}
              </div>
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleLogout}
            className="btn btn-ghost"
            style={{ width: '100%', justifyContent: isDesktopCollapsed ? 'center' : 'flex-start', padding: isDesktopCollapsed ? '8px 0' : '8px 12px' }}
            title={isDesktopCollapsed ? 'Keluar' : undefined}
          >
            <LogOut size={16} aria-hidden />
            <span style={{ display: isDesktopCollapsed ? 'none' : 'inline' }}>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className={`main-content ${isDesktopCollapsed ? 'collapsed' : ''}`}>
        <header className="topbar">
          <div className="topbar-left">
            {/* Mobile Hamburger Button */}
            <button
              type="button"
              className="hamburger-btn"
              onClick={() => setIsMobileNavOpen(true)}
              aria-label="Buka menu navigasi"
            >
              <Menu size={20} aria-hidden />
            </button>

            {/* Desktop Collapse / Expand Button */}
            <button
              type="button"
              className="desktop-collapse-btn"
              onClick={() => setIsDesktopCollapsed((prev) => !prev)}
              aria-label={isDesktopCollapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
              title={isDesktopCollapsed ? 'Lebarkan sidebar' : 'Ciutkan sidebar'}
            >
              {isDesktopCollapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
            </button>

            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--on-surface)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{currentPageTitle}</span>
              </div>
              <div className="small muted topbar-subtitle" style={{ fontSize: 12 }}>
                {pathname === '/dashboard' ? 'Ringkasan operasional terpadu' : 'E-Fulfill Hub · Shopee Open Platform'}
              </div>
            </div>
          </div>

          <div className="topbar-right">
            <span className="badge badge-success" style={{ display: 'inline-flex', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
              Shopee Terhubung
            </span>
            {me?.role ? (
              <span className="badge badge-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <UserCheck size={12} aria-hidden />
                {me.role}
              </span>
            ) : null}
          </div>
        </header>

        <main className="page-body">{children}</main>
      </div>
    </div>
  );
}
