'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Info,
  Zap,
  Circle,
  Inbox,
  CircleAlert,
} from 'lucide-react';

export type Tone = 'primary' | 'secondary' | 'warning' | 'danger' | 'success' | 'neutral';

const TONE_CLASS: Record<Tone, string> = {
  primary: 'badge-primary',
  secondary: 'badge-secondary',
  warning: 'badge-warning',
  danger: 'badge-danger',
  success: 'badge-success',
  neutral: 'badge-neutral',
};

const TONE_ICON: Record<Tone, typeof Info> = {
  primary: Zap,
  secondary: Info,
  warning: AlertTriangle,
  danger: AlertOctagon,
  success: CheckCircle2,
  neutral: Circle,
};

/** Indonesian labels + tone for every domain status (single source of truth). */
const STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  // Order
  NEW: { label: 'Baru', tone: 'neutral' },
  CONFIRMED: { label: 'Dikonfirmasi', tone: 'secondary' },
  CANCELLED: { label: 'Dibatalkan', tone: 'neutral' },
  COMPLETED: { label: 'Selesai', tone: 'success' },
  // Fulfillment
  WAITING_STOCK: { label: 'Menunggu Stok', tone: 'warning' },
  READY_TO_PICK: { label: 'Siap Dipick', tone: 'secondary' },
  PICKING: { label: 'Sedang Dipick', tone: 'primary' },
  PICKED: { label: 'Terpick', tone: 'secondary' },
  PACKING: { label: 'Dikemas', tone: 'primary' },
  PACKED: { label: 'Terkemas', tone: 'secondary' },
  READY_TO_SHIP: { label: 'Siap Kirim', tone: 'primary' },
  HANDED_OVER: { label: 'Diserahkan', tone: 'success' },
  EXCEPTION: { label: 'Pengecualian', tone: 'danger' },
  // Shipment
  PENDING: { label: 'Tertunda', tone: 'neutral' },
  PICKED_UP: { label: 'Diambil Kurir', tone: 'secondary' },
  IN_TRANSIT: { label: 'Dalam Perjalanan', tone: 'secondary' },
  DELIVERED: { label: 'Terkirim', tone: 'success' },
  FAILED: { label: 'Gagal', tone: 'danger' },
  RETURNED: { label: 'Dikembalikan', tone: 'neutral' },
  // Return
  REQUESTED: { label: 'Diajukan', tone: 'neutral' },
  IN_TRANSIT_RETURN: { label: 'Dalam Perjalanan', tone: 'secondary' },
  RECEIVED: { label: 'Diterima', tone: 'secondary' },
  INSPECTION: { label: 'Inspeksi', tone: 'warning' },
  RESTOCKED: { label: 'Restok', tone: 'success' },
  DAMAGED: { label: 'Rusak', tone: 'danger' },
  REJECTED: { label: 'Ditolak', tone: 'danger' },
  CLOSED: { label: 'Ditutup', tone: 'neutral' },
  // Priority
  CRITICAL: { label: 'Kritis', tone: 'danger' },
  HIGH: { label: 'Tinggi', tone: 'warning' },
  MEDIUM: { label: 'Sedang', tone: 'secondary' },
  LOW: { label: 'Rendah', tone: 'neutral' },
  // Order item
  RESERVED: { label: 'Terpesan', tone: 'secondary' },
  FULFILLED: { label: 'Terpenuhi', tone: 'success' },
  // Movement
  RECEIVE: { label: 'Stok Masuk', tone: 'success' },
  RESERVE: { label: 'Reservasi', tone: 'neutral' },
  RESERVE_RELEASE: { label: 'Lepas Reservasi', tone: 'neutral' },
  DEDUCTION: { label: 'Stok Keluar', tone: 'danger' },
  ADJUSTMENT: { label: 'Penyesuaian', tone: 'warning' },
  RETURN_RESTOCK: { label: 'Retur Restok', tone: 'success' },
  RETURN_DAMAGED: { label: 'Retur Rusak', tone: 'danger' },
  BLOCKED: { label: 'Diblokir', tone: 'neutral' },
  UNBLOCKED: { label: 'Buka Blokir', tone: 'neutral' },
  // Inspection
  SELLABLE: { label: 'Layak Jual', tone: 'success' },
  PARTIAL: { label: 'Sebagian', tone: 'warning' },
  // Sync
  RUNNING: { label: 'Berjalan', tone: 'secondary' },
  PROCESSED: { label: 'Diproses', tone: 'success' },
  SKIPPED: { label: 'Dilewati', tone: 'neutral' },
  // Connection
  ACTIVE: { label: 'Aktif', tone: 'success' },
  INACTIVE: { label: 'Nonaktif', tone: 'neutral' },
  ERROR: { label: 'Error', tone: 'danger' },
};

export function statusMeta(status: string | null | undefined): { label: string; tone: Tone } {
  if (!status) return { label: '—', tone: 'neutral' };
  return STATUS_LABELS[status] ?? { label: status, tone: 'neutral' };
}

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const { label, tone } = statusMeta(status);
  const Icon = TONE_ICON[tone];
  return (
    <span className={`badge ${TONE_CLASS[tone]}`}>
      <Icon size={12} strokeWidth={2} aria-hidden />
      {label}
    </span>
  );
}

export function StatCard({
  value,
  label,
  hint,
  tone = 'neutral',
  href,
}: {
  value: ReactNode;
  label: string;
  hint?: string;
  tone?: Tone;
  href?: string;
}) {
  const color =
    tone === 'danger' ? 'var(--on-error-container)'
    : tone === 'warning' ? 'var(--on-tertiary-container)'
    : tone === 'success' ? 'var(--on-success-container)'
    : tone === 'secondary' ? 'var(--on-secondary-container)'
    : 'var(--on-surface)';

  const inner = (
    <div className="stat-card">
      <div className="stat-value" style={{ color }}>{value}</div>
      <div style={{ fontWeight: 600 }}>{label}</div>
      {hint ? <div className="muted small">{hint}</div> : null}
    </div>
  );
  return href ? <Link href={href} style={{ color: 'inherit' }}>{inner}</Link> : inner;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row" style={{ gap: 8 }}>{actions}</div> : null}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="center-state">
      <div className="spinner" role="status" aria-label="Memuat" />
      <span>Memuat data...</span>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="center-state">
      <Inbox size={32} strokeWidth={1.5} style={{ opacity: 0.5 }} aria-hidden />
      <div style={{ fontWeight: 600, color: 'var(--on-surface)' }}>{title}</div>
      {description ? <div className="small">{description}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="center-state">
      <CircleAlert size={32} strokeWidth={1.5} style={{ color: 'var(--on-error-container)' }} aria-hidden />
      <div style={{ fontWeight: 600, color: 'var(--on-error-container)' }}>{message}</div>
      {onRetry ? (
        <button className="btn btn-secondary btn-sm" onClick={onRetry}>Coba Lagi</button>
      ) : null}
    </div>
  );
}

export function Alert({ tone, children }: { tone: 'info' | 'warning' | 'danger' | 'success'; children: ReactNode }) {
  const Icon = tone === 'danger' ? AlertOctagon : tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div className={`alert alert-${tone}`} role="status">
      <Icon size={18} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden />
      <div className="grow">{children}</div>
    </div>
  );
}
