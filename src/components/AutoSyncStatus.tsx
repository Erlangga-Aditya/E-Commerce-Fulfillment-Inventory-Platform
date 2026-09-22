'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  RefreshCw,
  Radio,
  CheckCircle2,
  Clock,
  ChevronDown,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';

interface ShopeeStatusResponse {
  connected: boolean;
  shop?: {
    id: string;
    externalShopId: string;
    name: string;
    tokenExpiresAt: string | null;
  };
}

export function AutoSyncStatus() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [shopName, setShopName] = useState<string>('Shopee Store');
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState<number>(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isSyncingRef = useRef(false);

  // Check connection status
  const checkStatus = useCallback(async () => {
    try {
      const res = await api<ShopeeStatusResponse>('/api/v1/integrations/shopee/status');
      if (res.connected && res.shop) {
        setConnected(true);
        setShopId(res.shop.id);
        setShopName(res.shop.name || 'Shopee Official Store');
        return res.shop.id;
      } else {
        setConnected(false);
        setShopId(null);
        return null;
      }
    } catch {
      setConnected(false);
      return null;
    }
  }, []);

  // Perform background sync
  const performSync = useCallback(async (targetShopId: string, silent = true) => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    if (!silent) setIsSyncing(true);
    else setIsSyncing(true);

    try {
      await api('/api/v1/integrations/shopee/sync-all', {
        method: 'POST',
        body: { shopId: targetShopId },
      });
      const now = new Date();
      setLastSyncedAt(now);
      setSecondsAgo(0);
      // Dispatch global broadcast event so all active pages refresh their data
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('shopee:synced', { detail: { timestamp: now.getTime() } }));
      }
    } catch (err) {
      console.warn('[AutoSync] Silent auto-sync warning:', err);
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  // Initialize and run auto-sync loop
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    let mounted = true;

    async function init() {
      const activeShopId = await checkStatus();
      if (!mounted) return;

      if (activeShopId) {
        // Initial auto-sync after a brief 2-second delay to keep initial render instant
        const timer = setTimeout(() => {
          if (mounted) performSync(activeShopId, true);
        }, 2000);

        // Continuous autonomous polling heartbeat: every 180 seconds (3 minutes)
        intervalId = setInterval(() => {
          if (mounted) performSync(activeShopId, true);
        }, 180000);

        return () => clearTimeout(timer);
      }
    }

    init();

    return () => {
      mounted = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [checkStatus, performSync]);

  // Sync on tab visibility change if inactive > 3 mins
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible' && shopId) {
        if (!lastSyncedAt || Date.now() - lastSyncedAt.getTime() > 180000) {
          performSync(shopId, true);
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [shopId, lastSyncedAt, performSync]);

  // Tick seconds ago timer
  useEffect(() => {
    const timer = setInterval(() => {
      if (lastSyncedAt) {
        setSecondsAgo(Math.floor((Date.now() - lastSyncedAt.getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lastSyncedAt]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  if (connected === false) {
    return (
      <span
        className="badge badge-neutral"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
        title="Shopee belum terhubung. Buka menu Integrasi untuk menghubungkan toko."
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--muted)' }} />
        Shopee Belum Terhubung
      </span>
    );
  }

  if (connected === null) {
    return (
      <span className="badge badge-neutral" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <RefreshCw size={11} className="spin" />
        <span>Memeriksa Shopee...</span>
      </span>
    );
  }

  const formatSecondsAgo = () => {
    if (!lastSyncedAt) return 'Sedang sinkronisasi awal...';
    if (secondsAgo < 10) return 'Baru saja';
    if (secondsAgo < 60) return `${secondsAgo}d lalu`;
    const mins = Math.floor(secondsAgo / 60);
    return `${mins}m lalu`;
  };

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`badge ${isSyncing ? 'badge-primary' : 'badge-success'}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
          border: '1px solid currentColor',
          padding: '4px 10px',
          fontWeight: 600,
          fontSize: 12,
          transition: 'all 0.15s ease',
        }}
        title="Klik untuk melihat detail status sinkronisasi realtime"
      >
        {isSyncing ? (
          <RefreshCw size={12} className="spin" />
        ) : (
          <span
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 8,
              height: 8,
            }}
          >
            <span
              style={{
                position: 'absolute',
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                background: 'currentColor',
                opacity: 0.75,
                animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
              }}
            />
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'currentColor',
              }}
            />
          </span>
        )}
        <span>
          {isSyncing ? 'Menyinkronkan Realtime...' : `Auto-Sync Aktif · ${formatSecondsAgo()}`}
        </span>
        <ChevronDown size={11} style={{ opacity: 0.7 }} />
      </button>

      {/* Popover Status Menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 320,
            background: 'var(--surface-container, #ffffff)',
            border: '1px solid var(--outline-variant, #e5e7eb)',
            borderRadius: 12,
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            padding: 16,
            zIndex: 1000,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: 'var(--success-container, #ecfdf5)',
                color: 'var(--success, #059669)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Radio size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--on-surface)' }}>
                Sinkronisasi Realtime Shopee
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                {shopName}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              background: 'var(--surface-low, #f9fafb)',
              padding: 10,
              borderRadius: 8,
              fontSize: 12,
              marginBottom: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <ShieldCheck size={13} color="var(--success, #10b981)" /> Webhook Push
              </span>
              <span style={{ fontWeight: 600, color: 'var(--success, #10b981)' }}>
                🟢 Real-time Aktif
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Clock size={13} /> Auto-Sync Polling
              </span>
              <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>
                Tiap 3 Menit (Tanpa Klik)
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <CheckCircle2 size={13} /> Terakhir Sinkron
              </span>
              <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>
                {lastSyncedAt ? lastSyncedAt.toLocaleTimeString('id-ID') : '—'}
              </span>
            </div>
          </div>

          <p style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4, margin: '0 0 12px 0' }}>
            ✨ Sistem bekerja secara otomatis. Pesanan masuk, nomor resi, dan pengembalian barang disinkronkan tanpa perlu mengklik tombol sinkronisasi.
          </p>

          <button
            type="button"
            className="btn btn-secondary"
            disabled={isSyncing}
            onClick={() => {
              if (shopId) performSync(shopId, false);
            }}
            style={{
              width: '100%',
              justifyContent: 'center',
              fontSize: 12,
              padding: '6px 12px',
              gap: 6,
            }}
          >
            <Zap size={13} />
            <span>{isSyncing ? 'Sedang Memperbarui...' : 'Paksa Sinkron Sekarang (Opsional)'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
