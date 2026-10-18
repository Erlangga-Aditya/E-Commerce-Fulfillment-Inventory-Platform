'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pagination } from '@/components/pagination';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Boxes,
  CheckCircle2,
  ExternalLink,
  History,
  PackageCheck,
  Printer,
  RefreshCw,
  ScanLine,
  Truck,
  XCircle,
} from 'lucide-react';
import { api, openOfficialLabel } from '@/lib/api';
import { usePermission } from '@/hooks/usePermission';
import { Alert, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';
import { BarcodeScanner, playScanFeedback } from '@/components/barcode-scanner';
import { StockPanel } from '@/components/stock-panel';
import { OrderCard } from './order-card';
import {
  type ScanOutcome,
  type Stage,
  type StationOrder,
  type StationResponse,
} from './types';

// Tipe data, label tahap, dan konstanta tampilan ada di ./types.ts
/** Batas operasi massal di sisi server. Disamakan supaya operator diberi tahu sebelum menekan tombol, bukan gagal setelahnya. */
const BATAS_MASSAL = 50;

/** Panduan 4 langkah — dilipat supaya tidak menambah deretan kartu di layar. */
function StepGuide() {
  const steps = [
    { no: 1, title: 'Pesanan masuk', desc: 'Otomatis dari Shopee' },
    { no: 2, title: 'Ambil resi', desc: 'Minta nomor resi ke Shopee' },
    { no: 3, title: 'Scan resi', desc: 'Stok gudang otomatis berkurang' },
    { no: 4, title: 'Serahkan ke kurir', desc: 'Paket selesai diproses' },
  ];
  return (
    <details className="card mb16" style={{ padding: '10px 14px' }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
        Alur kerja 4 langkah (buka untuk melihat)
      </summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
        {steps.map((s) => (
          <div key={s.no} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 200px' }}>
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: 'var(--primary-container)',
                color: 'var(--on-primary-container)',
                fontWeight: 800,
                fontSize: 12,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {s.no}
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 12.5 }}>{s.title}</div>
              <div className="small muted">{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

export default function PesananPengirimanPage() {
  const [data, setData] = useState<StationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger' | 'info' | 'warning'; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [printingLabelId, setPrintingLabelId] = useState<string | null>(null);
  const [sort, setSort] = useState<'oldest' | 'newest'>('oldest');
  const [stageFilter, setStageFilter] = useState<'SEMUA' | Stage>('SEMUA');
  const [statusKirimFilter, setStatusKirimFilter] = useState<'SEMUA' | string>('SEMUA');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [resiFilter, setResiFilter] = useState<'SEMUA' | 'sudah' | 'belum'>('SEMUA');
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [stockOpen, setStockOpen] = useState(false);
  const [stockVariantId, setStockVariantId] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [scannerFocusRequest, setScannerFocusRequest] = useState(0);

  // State untuk modal sinkronisasi data historis
  const [historicalModalOpen, setHistoricalModalOpen] = useState(false);
  const [historicalMonths, setHistoricalMonths] = useState(72); // 6 tahun default
  const [customFromDate, setCustomFromDate] = useState('');
  const [customToDate, setCustomToDate] = useState('');
  const [historicalBusy, setHistoricalBusy] = useState(false);
  const [historicalMessage, setHistoricalMessage] = useState<string | null>(null);

  /**
   * Pesanan yang dicentang untuk diproses sekaligus. Disimpan di state biasa
   * supaya jumlah terpilih ikut ter-render di panel bulk.
   */
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  // Staff boleh melihat halaman ini tanpa boleh melakukan semua aksinya.
  const { can } = usePermission();
  /**
   * Izin "stok minus" untuk SATU pemindaian berikutnya. Harus one-shot: begitu
   * dipakai langsung dibuang, supaya tidak pernah ikut terpakai untuk barcode
   * pesanan lain yang kebetulan dipindai setelahnya.
   */
  const [negativeStockApproved, setNegativeStockApproved] = useState(false);
  const scannerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (
      sortMode: 'oldest' | 'newest' = sort,
      pageArg: number = page,
      stageArg: 'SEMUA' | Stage = stageFilter,
      kataKunci: string = search,
      resiArg: 'SEMUA' | 'sudah' | 'belum' = resiFilter,
      statusKirimArg: 'SEMUA' | string = statusKirimFilter,
    ) => {
      try {
        const params = new URLSearchParams({ sort: sortMode, page: String(pageArg) });
        if (stageArg !== 'SEMUA') params.set('stage', stageArg);
        if (kataKunci.trim()) params.set('search', kataKunci.trim());
        if (resiArg !== 'SEMUA') params.set('resi', resiArg);
        if (statusKirimArg !== 'SEMUA') params.set('statusKirim', statusKirimArg);
        const res = await api<StationResponse>(`/api/v1/fulfillment/station?${params.toString()}`);
        setData(res);
        // Server bisa menjepit halaman yang diminta (misalnya halaman terakhir
        // menjadi kosong setelah pesanan diselesaikan). Halaman yang benar-benar
        // tampil diikuti supaya penanda halaman tidak berbohong.
        setPage(res.page);
        setError('');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [sort, page, stageFilter, search, resiFilter, statusKirimFilter],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await load();
    })();
    const onRealtime = () => void load();
    window.addEventListener('shopee:synced', onRealtime);
    window.addEventListener('fulfillment:updated', onRealtime);
    const refresh = setInterval(() => void load(), 30000);
    const clock = setInterval(() => setNow(new Date()), 60000);
    return () => {
      cancelled = true;
      window.removeEventListener('shopee:synced', onRealtime);
      window.removeEventListener('fulfillment:updated', onRealtime);
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [load]);

  /**
   * Ambil resi untuk semua pesanan yang dicentang sekaligus.
   *
   * Endpoint-nya partial success, jadi jawaban berisi mana yang berhasil dan
   * mana yang gagal. Yang gagal ditampilkan apa adanya supaya operator tahu
   * harus mencoba ulang pesanan mana — bukan diberi satu pesan "gagal" yang
   * tidak menjelaskan apa pun.
   */
  async function bulkAmbilResi(orderIds: string[]) {
    if (orderIds.length === 0) return;
    setBulkBusy(true);
    setError('');
    setNotice(null);
    try {
      const res = await api<{
        summary: { total: number; ok: number; gagal: number };
        results: { externalOrderId: string; status: string; message: string }[];
        message: string;
      }>('/api/v1/orders/bulk-prepare-shipment', { method: 'POST', body: { orderIds } });

      const gagal = res.results.filter((r) => r.status !== 'OK');
      if (gagal.length === 0) {
        setNotice({ tone: 'success', text: res.message });
      } else {
        setNotice({
          tone: 'warning',
          text: `${res.message} Gagal: ${gagal.map((g) => `${g.externalOrderId} (${g.message})`).join('; ')}`,
        });
      }
      await load();
      setPicked([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  /** Unduh label PDF gabungan untuk pesanan yang dicentang. */
  async function bulkCetakLabel(orderIds: string[]) {
    if (orderIds.length === 0) return;
    setBulkBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/orders/bulk-print-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds }),
        credentials: 'include',
      });

      // Server melaporkan label yang gagal lewat header supaya operator tahu
      // mana yang perlu diunduh satu per satu, tanpa membatalkan yang berhasil.
      const gagal = res.headers.get('X-Label-Gagal-Daftar');
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? `Gagal membuat label (${res.status}).`);
        return;
      }
      if (gagal) setNotice({ tone: 'warning', text: `Sebagian label gagal: ${decodeURIComponent(gagal)}` });
      else setNotice({ tone: 'success', text: `${res.headers.get('X-Label-Ok')} label siap dicetak.` });

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBulkBusy(false);
    }
  }

  /**
   * Centang/hapus-centang satu pesanan.
   *
   * Pesanan final (batal, sudah dikirim, sudah diterima pembeli) tidak punya
   * `canSelectForBulk`, jadi tidak pernah ikut pada operasi massal. Dulu pesanan
   * seperti itu bisa terkirim ke "Ambil Resi Semua" lalu ditolak satu per satu
   * oleh server — kegagalan yang sebenarnya bisa dicegah di layar.
   */
  const togglePick = (orderId: string) =>
    setPicked((prev) => (prev.includes(orderId) ? prev.filter((x) => x !== orderId) : [...prev, orderId]));

  const filtered = data?.orders ?? [];
  const totalPesanan = data?.total ?? 0;
  const totalHalaman = data?.totalPages ?? 1;

  /** Menandai bahwa operator sedang melihat hasil yang terpotong pagar pengaman. */
  const terpotong = data?.truncated === true;

  /** Pesanan yang dicentang DAN masih boleh diproses (kelayakan dari server). */
  const pickedOrders = filtered.filter((o) => picked.includes(o.orderId) && o.workflow.canSelectForBulk);
  const pickedIds = pickedOrders.map((o) => o.orderId);
  const jumlahSiapAmbilResi = pickedOrders.filter((o) => o.workflow.canArrangeShipment).length;
  const jumlahSiapCetakLabel = pickedOrders.filter((o) => o.workflow.canPrintLabel).length;

  /** Hanya pesanan yang masih punya langkah kerja yang bisa dicentang di halaman ini. */
  const idBisaDipilih = filtered.filter((o) => o.workflow.canSelectForBulk).map((o) => o.orderId);
  const semuaTerpilih = idBisaDipilih.length > 0 && idBisaDipilih.every((id) => picked.includes(id));
  const sebagianTerpilih = !semuaTerpilih && idBisaDipilih.some((id) => picked.includes(id));

  /**
   * Centang/hapus-centang SEMUA pesanan yang masih bisa diproses di halaman ini.
   *
   * Sengaja hanya berlaku untuk halaman ini, bukan seluruh hasil: operator harus
   * melihat sendiri apa yang akan diproses. Operasi massal dibatasi server
   * (BATAS_MASSAL), jadi bila pilihannya melewati batas itu, operator diberi
   * tahu LEBIH DULU - bukan gagal setelah menekan tombol.
   */
  const toggleSemuaDiHalaman = () =>
    setPicked((prev) =>
      semuaTerpilih
        ? prev.filter((id) => !idBisaDipilih.includes(id))
        : [...new Set([...prev, ...idBisaDipilih])],
    );
  const gantiTahap = (tahap: 'SEMUA' | Stage) => {
    setStageFilter(tahap);
    setStatusKirimFilter('SEMUA');
    setPage(1);
    setLoading(true);
  };

  /** Kembali ke halaman 1 saat kata kunci berubah, dengan alasan yang sama. */
  const ubahPencarian = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  const ubahResi = (v: 'SEMUA' | 'sudah' | 'belum') => {
    setResiFilter(v);
    setPage(1);
    setLoading(true);
  };

  const ubahStatusKirim = (v: 'SEMUA' | string) => {
    setStatusKirimFilter(v);
    if (v !== 'SEMUA') setStageFilter('SEMUA');
    setPage(1);
    setLoading(true);
  };

  const resetSemuaFilter = () => {
    setStageFilter('SEMUA');
    setStatusKirimFilter('SEMUA');
    setResiFilter('SEMUA');
    setSearch('');
    setPage(1);
    setLoading(true);
  };

  async function handleHistoricalSync() {
    setHistoricalBusy(true);
    setHistoricalMessage(null);
    try {
      const body: Record<string, unknown> = {};
      if (historicalMonths === -1) {
        if (customFromDate) body.fromDate = customFromDate;
        if (customToDate) body.toDate = customToDate;
      } else {
        body.months = historicalMonths;
      }
      const res = await api<{ message: string; result: unknown }>(
        '/api/v1/integrations/shopee/historical-sync',
        { method: 'POST', body },
      );
      setHistoricalMessage(res.message);
      setNotice({ tone: 'success', text: res.message });
      setLoading(true);
      await load();
    } catch (e) {
      setHistoricalMessage(`Gagal: ${(e as Error).message}`);
      setNotice({ tone: 'danger', text: (e as Error).message });
    } finally {
      setHistoricalBusy(false);
    }
  }

  // Cetak label RESMI Shopee: unduh file dari Shopee, lalu buka di tab baru.
 // Tidak pernah memakai label buatan — kalau Shopee menolak, tampilkan pesan errornya.
 async function handlePrintOfficialLabel(orderId: string, orderSn: string) {
   setPrintingLabelId(orderId);
   setNotice(null);
   try {
     await openOfficialLabel(orderId);
   } catch (err) {
     setNotice({
       tone: 'danger',
       text: `Label resmi pesanan ${orderSn} belum bisa dicetak: ${(err as Error).message}`,
     });
   } finally {
     setPrintingLabelId(null);
   }
 }

  async function run(key: string, fn: () => Promise<unknown>, successMsg?: string) {
    setBusyKey(key);
    setNotice(null);
    try {
      const result = await fn();
      if (successMsg) setNotice({ tone: 'success', text: successMsg });
      await load(sort);
      return result;
    } catch (e) {
      setNotice({ tone: 'danger', text: (e as Error).message });
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  const scanResi = useCallback(
    async (code: string) => {
      setBusyKey('scan');
      setNotice(null);
      try {
        // Izin stok minus hanya berlaku untuk SATU pemindaian berikutnya (one-shot):
        // langsung dibuang setelah dipakai supaya tidak pernah "bocor" ke barcode
        // pesanan lain yang dipindai berikutnya.
        const allowNegativeStock = negativeStockApproved;
        if (negativeStockApproved) setNegativeStockApproved(false);

        const res = await api<ScanOutcome>('/api/v1/fulfillment/scan-awb', {
          method: 'POST',
          body: {
            scannedCode: code,
            confirmPicking: true,
            allowNegativeStock,
          },
        });
        setOutcome(res);
        playScanFeedback(res.stockDeducted || res.code !== 'NOT_FOUND');
        await load(sort);
      } catch (e) {
        setOutcome(null);
        setNotice({ tone: 'danger', text: (e as Error).message });
        playScanFeedback(false);
      } finally {
        setBusyKey(null);
      }
    },
    [load, negativeStockApproved, sort],
  );

  async function ambilResi(orderId: string) {
    return run(
      `resi-${orderId}`,
      async () => {
        const res = await api<{ message: string }>(`/api/v1/orders/${orderId}/prepare-shipment`, {
          method: 'POST',
          body: {},
        });
        setNotice({ tone: 'success', text: res.message });
        return res;
      },
      undefined,
    );
  }

  async function siapkanTanpaResi(order: StationOrder) {
    if (!data?.warehouse) {
      setNotice({ tone: 'danger', text: 'Belum ada gudang aktif. Tambahkan gudang di menu Pengaturan.' });
      return;
    }
    return run(
      `siap-${order.orderId}`,
      () => api(`/api/v1/orders/${order.orderId}/reserve`, { method: 'POST', body: { warehouseId: data.warehouse!.id } }),
      'Pesanan siap dikemas. Scan resinya untuk menyelesaikan.',
    );
  }

  function focusScanner() {
    setScannerFocusRequest((value) => value + 1);
    scannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function focusScannerForOrder(order: StationOrder) {
    setStageFilter('SEMUA');
    setScannerFocusRequest((value) => value + 1);
    setNotice({
      tone: 'info',
      text: `Pindai barcode resi untuk pesanan ${order.externalOrderId}. Jangan ketik nomor pesanan sebagai pengganti resi.`,
    });
    scannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function changeSort(next: 'oldest' | 'newest') {
    setSort(next);
    setLoading(true);
    void load(next);
  }

  // Layar penuh HANYA pada pemuatan pertama. Sebelumnya setiap perubahan filter
  // mengganti seluruh pohon komponen, sehingga kotak scan ikut ter-mount ulang
  // dan meminta fokus sendiri — di ponsel itu langsung membuka keyboard.
  if (loading && !data) return <LoadingState message="Memuat daftar pesanan..." />;
  if (error && !data) return <ErrorState message={error} onRetry={() => { setLoading(true); void load(sort); }} />;

  const stages = data?.stages;
  // Jumlah di tiap tab berasal dari server (stages), bukan dari panjang daftar
  // yang sedang tampil. Kalau dihitung dari daftar yang tampil, angkanya akan
  // berubah mengikuti halaman dan tidak lagi menggambarkan keadaan sebenarnya.
  const r = data?.ringkasan;
  const filters: Array<{ key: 'SEMUA' | Stage; label: string; count: number }> = [
    {
      key: 'SEMUA',
      label: 'Semua',
      count:
        (stages?.baru ?? 0) +
        (stages?.menungguStok ?? 0) +
        (stages?.siapDikemas ?? 0) +
        (stages?.siapKirim ?? 0) +
        (stages?.dikirim ?? 0) +
        (stages?.selesai ?? 0) +
        (stages?.dibatalkan ?? 0),
    },
    { key: 'BARU', label: 'Pesanan Baru', count: stages?.baru ?? 0 },
    { key: 'MENUNGGU_STOK', label: 'Menunggu Stok', count: stages?.menungguStok ?? 0 },
    { key: 'SIAP_DIKEMAS', label: 'Siap Dikemas', count: stages?.siapDikemas ?? 0 },
    { key: 'SIAP_KIRIM', label: 'Siap Kirim', count: stages?.siapKirim ?? 0 },
    { key: 'DIKIRIM', label: 'Sudah Dikirim', count: stages?.dikirim ?? 0 },
    { key: 'SELESAI', label: 'Selesai', count: stages?.selesai ?? 0 },
    { key: 'DIBATALKAN', label: 'Dibatalkan', count: stages?.dibatalkan ?? 0 },
  ];

  /**
   * Penyaring keadaan paket. Dulu ini 10 KARTU terpisah di bawah 7 kartu tahap,
   * sehingga satu layar penuh hanya berisi ringkasan. Sekarang bentuknya chip:
   * angkanya tetap terbaca, tetapi tidak lagi mendorong daftar pesanan ke bawah.
   */
  const stateFilters: Array<{ key: string; label: string; count: number; active: boolean; onClick: () => void }> = [
    {
      key: 'belumResi',
      label: 'Belum ada resi',
      count: r?.belumResi ?? 0,
      active: resiFilter === 'belum',
      onClick: () => ubahResi(resiFilter === 'belum' ? 'SEMUA' : 'belum'),
    },
    {
      key: 'sudahResi',
      label: 'Sudah ada resi',
      count: r?.sudahResi ?? 0,
      active: resiFilter === 'sudah',
      onClick: () => ubahResi(resiFilter === 'sudah' ? 'SEMUA' : 'sudah'),
    },
    {
      key: 'belumDijemput',
      label: 'Belum dijemput kurir',
      count: r?.belumDijemput ?? 0,
      active: statusKirimFilter === 'belumDijemput',
      onClick: () => ubahStatusKirim(statusKirimFilter === 'belumDijemput' ? 'SEMUA' : 'belumDijemput'),
    },
    {
      key: 'diPerjalanan',
      label: 'Di perjalanan',
      count: r?.diPerjalanan ?? 0,
      active: statusKirimFilter === 'diPerjalanan',
      onClick: () => ubahStatusKirim(statusKirimFilter === 'diPerjalanan' ? 'SEMUA' : 'diPerjalanan'),
    },
    {
      key: 'sudahSampai',
      label: 'Diterima pembeli',
      count: r?.sudahSampai ?? 0,
      active: statusKirimFilter === 'sudahSampai',
      onClick: () => ubahStatusKirim(statusKirimFilter === 'sudahSampai' ? 'SEMUA' : 'sudahSampai'),
    },
    {
      key: 'gagalKirim',
      label: 'Gagal kirim',
      count: r?.gagalKirim ?? 0,
      active: statusKirimFilter === 'gagalKirim',
      onClick: () => ubahStatusKirim(statusKirimFilter === 'gagalKirim' ? 'SEMUA' : 'gagalKirim'),
    },
  ];

  return (
    <div style={{ paddingBottom: 60 }}>
      <PageHeader
        title="Pesanan & Pengiriman"
        subtitle="Pesanan masuk sampai diserahkan ke kurir — semua dikerjakan di halaman ini"
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setHistoricalModalOpen(true)}
              title="Tarik data transaksi penjualan historis dari Shopee (hingga 6 tahun)"
            >
              <History size={14} aria-hidden />
              <span>Tarik Data Historis</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setStockVariantId(null);
                setStockOpen(true);
              }}
              title="Tambah atau kurangi stok gudang"
            >
              <Boxes size={14} aria-hidden />
              <span>Stok Gudang</span>
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setLoading(true);
                void load(sort);
              }}
              title="Muat ulang data dari server"
            >
              <RefreshCw size={14} aria-hidden />
              <span>Muat Ulang</span>
            </button>
          </div>
        }
      />

      {notice && (
        <div className="mb16">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      {!data?.warehouse && (
        <div className="mb16">
          <Alert tone="warning">
            Belum ada gudang aktif. Tambahkan gudang di menu <strong>Pengaturan</strong> supaya pesanan bisa diproses.
          </Alert>
        </div>
      )}

      <StepGuide />

      <div className="card mb20" ref={scannerRef}>
        <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScanLine size={18} aria-hidden />
          <span>Scan Resi</span>
        </h2>
        <p className="small muted" style={{ marginTop: 0, marginBottom: 12 }}>
          Scan hanya dipakai saat pesanan sudah berstatus <strong>Siap Dikemas</strong>. Pastikan nomor resi sudah muncul
          dan stok gudang cukup. Setelah discan, stok berkurang dan pesanan otomatis berpindah ke <strong>Siap Kirim</strong>;
          setelah itu baru tekan <strong>Serahkan ke Kurir</strong>.
        </p>

        <BarcodeScanner
          autoFocus={false}
          label=""
          submitLabel="Selesaikan"
          placeholder="Scan barcode resi (bukan nomor pesanan)"
          focusRequest={scannerFocusRequest}
          onScan={(code) => {
            void scanResi(code);
          }}
          hint="Pindai barcode resi dengan kamera atau alat scan USB. Nomor resi harus sama dengan yang tertera di paket."
        />

        {outcome && (
          <div
            style={{
              marginTop: 14,
              border: `1px solid ${
                outcome.code === 'PACKED' || outcome.code === 'ALREADY_PACKED' || outcome.code === 'ALREADY_HANDED_OVER'
                  ? 'var(--success, #10b981)'
                  : outcome.code === 'NOT_FOUND' || outcome.code === 'CANCELLED'
                    ? 'var(--danger, #ef4444)'
                    : 'var(--warning, #f59e0b)'
              }`,
              borderRadius: 12,
              padding: 16,
              background: 'var(--surface-container, #fff)',
            }}
          >
            <div style={{ display: 'flex', gap: 10 }}>
              {outcome.code === 'PACKED' || outcome.code === 'ALREADY_PACKED' || outcome.code === 'ALREADY_HANDED_OVER' ? (
                <CheckCircle2 size={20} aria-hidden style={{ color: 'var(--success, #10b981)', flexShrink: 0 }} />
              ) : outcome.code === 'NOT_FOUND' || outcome.code === 'EXCEPTION' || outcome.code === 'CANCELLED' ? (
                <XCircle size={20} aria-hidden style={{ color: 'var(--danger, #ef4444)', flexShrink: 0 }} />
              ) : (
                <AlertTriangle size={20} aria-hidden style={{ color: 'var(--warning, #f59e0b)', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {outcome.code === 'PACKED'
                    ? 'Pesanan selesai diproses — stok gudang sudah berkurang'
                    : outcome.code === 'NEEDS_SHIPMENT'
                      ? 'Resi belum ada — atur pengiriman dulu'
                    : outcome.code === 'ALREADY_PACKED'
                      ? 'Pesanan ini sudah pernah diselesaikan'
                      : outcome.code === 'ALREADY_HANDED_OVER'
                        ? 'Pesanan sudah diserahkan ke kurir'
                        : outcome.code === 'CANCELLED'
                          ? 'Pesanan dibatalkan — resi tidak perlu diproses'
                          : outcome.code === 'ALREADY_DELIVERED'
                            ? 'Pesanan sudah diterima pembeli'
                            : outcome.code === 'NOT_FOUND'
                              ? 'Resi / nomor pesanan tidak dikenali'
                              : 'Belum bisa diselesaikan'}
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5 }}>{outcome.message}</p>

                {outcome.shortfalls.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                    {outcome.shortfalls.map((s) => (
                      <li key={s.sku}>
                        <code className="mono">{s.sku}</code> — {s.productName}: butuh {s.required}, ada {s.available},
                        kurang <strong>{s.missing}</strong>
                      </li>
                    ))}
                  </ul>
                )}

                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {outcome.order && (
                    <>
                      {outcome.order.canPrintOfficialLabel ? (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={printingLabelId === outcome.order.id}
                          onClick={() => void handlePrintOfficialLabel(outcome.order!.id, outcome.order!.externalOrderId)}
                        >
                          <Printer size={13} aria-hidden />
                          <span>
                            {printingLabelId === outcome.order.id ? 'Menyiapkan label…' : 'Cetak Label Resi'}
                          </span>
                        </button>
                      ) : (
                        <span className="small muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Printer size={13} aria-hidden />
                          <span>Label resmi muncul setelah nomor resi dari Shopee ada</span>
                        </span>
                      )}
                      <Link className="btn btn-ghost btn-sm" href={`/dashboard/pesanan/${outcome.order.id}`}>
                        <ExternalLink size={13} aria-hidden />
                        <span>Lihat Detail Pesanan</span>
                      </Link>
                    </>
                  )}
                  {outcome.code === 'NEEDS_SHIPMENT' && outcome.order && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busyKey === `resi-${outcome.order.id}`}
                      onClick={() => void ambilResi(outcome.order!.id)}
                    >
                      <Truck size={13} aria-hidden />
                      <span>Ambil Resi dari Shopee</span>
                    </button>
                  )}
                  {outcome.needsConfirmation === 'NEGATIVE_STOCK' && outcome.order && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busyKey === 'scan'}
                      onClick={() => {
                        setOutcome(null);
                        setNegativeStockApproved(true);
                        setNotice({ tone: 'info', text: 'Pindai ulang barcode resi paket ini untuk melanjutkan dengan stok minus.' });
                        focusScanner();
                      }}
                    >
                      <PackageCheck size={13} aria-hidden />
                      <span>Tetap kirim (stok jadi minus)</span>
                    </button>
                  )}
                  {(outcome.needsConfirmation === 'NEGATIVE_STOCK' || outcome.code === 'NOT_FOUND') && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setStockVariantId(null);
                        setStockOpen(true);
                      }}
                    >
                      <Boxes size={13} aria-hidden />
                      <span>Buka Stok Gudang</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stok gudang */}
      <StockPanel
        open={stockOpen}
        onClose={() => {
          setStockOpen(false);
          setStockVariantId(null);
        }}
        warehouseId={data?.warehouse?.id ?? null}
        prefillVariantId={stockVariantId}
        onDone={(message) => {
          setNotice({ tone: 'success', text: message });
          void load(sort);
        }}
      />

      {/* Daftar pesanan */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>
          Daftar Pesanan ({totalPesanan})
        </h2>
        {idBisaDipilih.length > 0 && (
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}
            title="Centang semua pesanan yang masih perlu diproses di halaman ini"
          >
            <input
              type="checkbox"
              checked={semuaTerpilih}
              ref={(el) => {
                if (el) el.indeterminate = sebagianTerpilih;
              }}
              onChange={toggleSemuaDiHalaman}
              style={{ width: 16, height: 16 }}
            />
            <span>
              Pilih semua di halaman ini ({idBisaDipilih.length} pesanan perlu diproses)
            </span>
          </label>
        )}
        <div className="filter-chips">
          <button
            type="button"
            className={`btn btn-sm ${sort === 'oldest' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => changeSort('oldest')}
            title="Pesanan yang paling lama menunggu ditampilkan lebih dulu"
          >
            <ArrowUpWideNarrow size={13} aria-hidden />
            <span>Terlama dulu</span>
          </button>
          <button
            type="button"
            className={`btn btn-sm ${sort === 'newest' ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => changeSort('newest')}
            title="Pesanan terbaru ditampilkan lebih dulu"
          >
            <ArrowDownWideNarrow size={13} aria-hidden />
            <span>Terbaru dulu</span>
          </button>
        </div>
      </div>

      {/* Indikator filter aktif dan tombol reset jika ada filter yang menyala */}
      {(stageFilter !== 'SEMUA' || resiFilter !== 'SEMUA' || statusKirimFilter !== 'SEMUA' || search) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(14, 165, 233, 0.08)',
            border: '1px solid var(--border)',
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          <div>
            <strong>Filter aktif: </strong>
            {stageFilter !== 'SEMUA' && <span className="chip" style={{ marginRight: 6 }}>Tahap: {stageFilter}</span>}
            {statusKirimFilter !== 'SEMUA' && <span className="chip" style={{ marginRight: 6 }}>Kategori: {statusKirimFilter}</span>}
            {resiFilter !== 'SEMUA' && <span className="chip" style={{ marginRight: 6 }}>Resi: {resiFilter}</span>}
            {search && <span className="chip" style={{ marginRight: 6 }}>Pencarian: &quot;{search}&quot;</span>}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={resetSemuaFilter}
            style={{ padding: '3px 8px', fontSize: 12 }}
          >
            Reset Semua Filter
          </button>
        </div>
      )}

      {/* Pencarian: nomor pesanan, nomor resi, nama pembeli, atau SKU. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <input
          type="search"
          value={search}
          onChange={(e) => ubahPencarian(e.target.value)}
          placeholder="Cari nomor pesanan, nomor resi, nama pembeli, atau SKU"
          aria-label="Cari pesanan"
          style={{
            flex: '1 1 320px',
            minWidth: 0,
            padding: '9px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'inherit',
            fontSize: 14,
          }}
        />
      </div>

      {/* Penyaring: satu baris chip per kelompok. Dulu ada 17 kartu ringkasan
          (7 tahap + 10 keadaan paket) yang membuat satu layar penuh tanpa daftar
          pesanan; angkanya sekarang menempel di chip. */}
      <div className="card mb16" style={{ padding: '10px 12px' }}>
        <div className="small muted" style={{ fontWeight: 700, marginBottom: 6 }}>Tahap kerja</div>
        <div className="filter-chips" style={{ marginBottom: 10 }}>
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`btn btn-sm ${stageFilter === f.key ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => gantiTahap(f.key)}
            >
              <span>
                {f.label} ({f.count})
              </span>
            </button>
          ))}
        </div>
        <div className="small muted" style={{ fontWeight: 700, marginBottom: 6 }}>Keadaan paket</div>
        <div className="filter-chips">
          {stateFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`btn btn-sm ${f.active ? 'btn-primary' : 'btn-secondary'}`}
              onClick={f.onClick}
            >
              <span>
                {f.label} ({f.count})
              </span>
            </button>
          ))}
        </div>
      </div>

      {terpotong && (
        <div
          className="card mb16"
          style={{ borderLeft: '4px solid var(--warning)', background: 'var(--tertiary-container)', padding: '10px 14px' }}
        >
          <strong>Daftar ini dipotong.</strong> Terlalu banyak pesanan untuk ditampilkan sekaligus,
          jadi hanya sebagian yang dihitung. Selesaikan atau batalkan pesanan lama, lalu muat ulang
          halaman ini — jangan menganggap semua pesanan sudah tampil.
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card">
          <EmptyState title="Tidak ada pesanan di tahap ini" description="Pilih filter lain, atau tunggu pesanan baru masuk dari Shopee." />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {pickedOrders.length > 0 && (
            <div className="card bulk-bar">
              <strong>
                {pickedOrders.length} pesanan dipilih
                {pickedOrders.length > BATAS_MASSAL ? (
                  <span style={{ display: 'block', fontWeight: 400, marginTop: 2 }}>
                    Maksimal {BATAS_MASSAL} pesanan sekali proses. Kurangi pilihan menjadi{' '}
                    {BATAS_MASSAL} atau kurang.
                  </span>
                ) : null}
              </strong>
              {can('order.prepare_shipment') ? (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void bulkAmbilResi(pickedIds)}
                  disabled={bulkBusy || jumlahSiapAmbilResi === 0 || pickedOrders.length > BATAS_MASSAL}
                  title={
                    jumlahSiapAmbilResi === 0
                      ? 'Semua pesanan pilihan sudah punya resi atau sudah final.'
                      : 'Minta nomor resi ke Shopee untuk semua pesanan yang dicentang'
                  }
                >
                  <Truck size={13} aria-hidden />
                  <span>
                    {bulkBusy ? 'Memproses...' : `Ambil Resi Semua (${jumlahSiapAmbilResi})`}
                  </span>
                </button>
              ) : null}
              {can('order.pack') ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void bulkCetakLabel(pickedIds)}
                  disabled={bulkBusy || jumlahSiapCetakLabel === 0}
                  title="Unduh label resmi Shopee untuk semua pesanan yang dicentang dalam satu PDF"
                >
                  <Printer size={13} aria-hidden />
                  <span>Cetak Label Semua ({jumlahSiapCetakLabel})</span>
                </button>
              ) : null}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked([])} disabled={bulkBusy}>
                Batal pilih
              </button>
            </div>
          )}
          {filtered.map((o) => (
            <OrderCard
              key={o.orderId}
              order={o}
              now={now}
              picked={picked.includes(o.orderId)}
              busyKey={busyKey}
              printingLabelId={printingLabelId}
              selectable={o.workflow.canSelectForBulk}
              onTogglePick={() => togglePick(o.orderId)}
              onAmbilResi={() => void ambilResi(o.orderId)}
              onProses={() => void siapkanTanpaResi(o)}
              onHandover={() =>
                void run(
                  `serah-${o.orderId}`,
                  () =>
                    api(`/api/v1/fulfillment/orders/${o.fulfillmentId}/handover`, {
                      method: 'POST',
                      body: o.awb ? { awb: o.awb, carrier: o.carrier ?? undefined } : {},
                    }),
                  'Paket sudah diserahkan ke kurir.',
                )
              }
              onFocusScanner={() => focusScannerForOrder(o)}
              onPrintLabel={() => void handlePrintOfficialLabel(o.orderId, o.externalOrderId)}
              onAddStock={(variantId) => {
                setStockVariantId(variantId);
                setStockOpen(true);
              }}
            />
          ))}

          <Pagination
            info={{
              total: totalPesanan,
              page: data?.page ?? 1,
              pageSize: data?.pageSize ?? 20,
              totalPages: totalHalaman,
            }}
            onChange={setPage}
            label="pesanan"
            disabled={loading}
          />
        </div>
      )}

      {/* Modal Sinkronisasi Data Historis Shopee */}
      {historicalModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.65)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => !historicalBusy && setHistoricalModalOpen(false)}
        >
          <div
            className="card"
            style={{
              maxWidth: 520,
              width: '100%',
              padding: 24,
              boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
              borderRadius: 12,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
                <History size={20} color="var(--primary)" />
                <span>Tarik Data Historis Shopee</span>
              </h3>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setHistoricalModalOpen(false)}
                disabled={historicalBusy}
                style={{ borderRadius: '50%', width: 28, height: 28, padding: 0 }}
              >
                ✕
              </button>
            </div>

            <p className="small muted" style={{ lineHeight: 1.5, marginTop: 0, marginBottom: 16 }}>
              Shopee Open API membatasi pengambilan transaksi maksimal 15 hari per permintaan. Fitur ini secara otomatis membagi rentang waktu menjadi potongan (chunks 14 hari) mundur untuk mengimpor seluruh transaksi lama tanpa duplikasi.
            </p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 13, fontWeight: 700, display: 'block', marginBottom: 8 }}>
                Pilih Rentang Waktu Penarikan:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {[
                  { value: 1, label: '30 Hari Terakhir' },
                  { value: 3, label: '3 Bulan Terakhir' },
                  { value: 12, label: '1 Tahun Terakhir' },
                  { value: 36, label: '3 Tahun Terakhir' },
                  { value: 72, label: 'Semua (6 Tahun)' },
                  { value: -1, label: 'Kustom Tanggal' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`btn btn-sm ${historicalMonths === opt.value ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setHistoricalMonths(opt.value)}
                    disabled={historicalBusy}
                    style={{ justifyContent: 'center' }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {historicalMonths === -1 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }} className="muted">
                    Dari Tanggal:
                  </label>
                  <input
                    type="date"
                    value={customFromDate}
                    onChange={(e) => setCustomFromDate(e.target.value)}
                    disabled={historicalBusy}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, display: 'block', marginBottom: 4 }} className="muted">
                    Sampai Tanggal:
                  </label>
                  <input
                    type="date"
                    value={customToDate}
                    onChange={(e) => setCustomToDate(e.target.value)}
                    disabled={historicalBusy}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)' }}
                  />
                </div>
              </div>
            )}

            {historicalMessage && (
              <div style={{ marginBottom: 16 }}>
                <Alert tone={historicalMessage.startsWith('Gagal') ? 'danger' : 'success'}>
                  {historicalMessage}
                </Alert>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setHistoricalModalOpen(false)}
                disabled={historicalBusy}
              >
                Tutup
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleHistoricalSync}
                disabled={historicalBusy}
              >
                {historicalBusy ? (
                  <>
                    <RefreshCw size={14} className="spin" aria-hidden />
                    <span>Sedang Menarik Data...</span>
                  </>
                ) : (
                  <>
                    <History size={14} aria-hidden />
                    <span>Mulai Tarik Data</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
