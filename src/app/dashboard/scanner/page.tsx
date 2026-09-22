'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  ScanLine,
  Barcode,
  Check,
  Camera,
  CameraOff,
  SwitchCamera,
  Volume2,
  VolumeX,
  Layers,
  Sparkles,
} from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, LoadingState, ErrorState, EmptyState, Alert } from '@/components/ui';

interface PickItem {
  id: string;
  sku: string;
  variantName: string;
  barcode: string | null;
  expectedQuantity: number;
  pickedQuantity: number;
  isConfirmed: boolean;
}

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
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Camera Scanner State ───────────────────────────────────────────────────
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hasBarcodeDetector, setHasBarcodeDetector] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const lastScannedCodeRef = useRef<{ code: string; time: number } | null>(null);

  // Check BarcodeDetector support
  useEffect(() => {
    if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      setHasBarcodeDetector(true);
    }
  }, []);

  const load = useCallback(() => {
    api<{
      items: Array<{
        id: string;
        status: string;
        order: { externalOrderId: string };
        pickingTasks: Array<{ id: string; status: string; items: PickItem[] }>;
      }>;
    }>('/api/v1/fulfillment/queue?status=PICKING')
      .then((d) => {
        const mapped: Task[] = (d.items ?? []).flatMap((f) =>
          f.pickingTasks.map((t) => ({
            id: t.id,
            status: f.status,
            orderExternalId: f.order.externalOrderId,
            items: t.items,
          })),
        );
        setTasks(mapped);
        setSelected((prev) => mapped.find((m) => m.id === prev?.id) ?? mapped[0] ?? null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  // Play audio beep
  const playBeep = useCallback((success = true) => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = success ? 'sine' : 'sawtooth';
      osc.frequency.setValueAtTime(success ? 880 : 330, ctx.currentTime);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (success ? 0.15 : 0.3));
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (success ? 0.15 : 0.3));
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(success ? [80] : [150, 80, 150]);
      }
    } catch {
      // Audio context might be restricted before first user interaction
    }
  }, [soundEnabled]);

  // Execute barcode validation via API
  const executeScan = useCallback(
    async (scannedText: string) => {
      if (!selected || !scannedText.trim() || validating) return;
      setResult(null);
      setValidating(true);
      try {
        const res = await api<ScanResp>(`/api/v1/fulfillment/tasks/${selected.id}/scan`, {
          method: 'POST',
          body: { scannedCode: scannedText.trim() },
        });
        setResult(res);
        playBeep(res.success);
        setCode('');
        if (res.allConfirmed) load();
      } catch (err) {
        setResult({ success: false, error: { code: 'NETWORK', message: (err as Error).message } });
        playBeep(false);
      } finally {
        setValidating(false);
        inputRef.current?.focus();
      }
    },
    [selected, validating, playBeep, load],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    await executeScan(code.trim());
  }

  // ── Camera Scanner Lifecycle ───────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    setCameraError(null);
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    setCameraError(null);
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
    } catch (err) {
      setCameraError(`Gagal mengakses kamera: ${(err as Error).message}. Pastikan izin kamera telah diberikan.`);
      setCameraActive(false);
    }
  }, [facingMode, stopCamera]);

  // Continuous frame detection loop
  useEffect(() => {
    if (!cameraActive) return;

    let isScanning = true;
    let detectorInstance: any = null;

    if (hasBarcodeDetector && typeof window !== 'undefined' && 'BarcodeDetector' in window) {
      try {
        detectorInstance = new (window as any).BarcodeDetector({
          formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e'],
        });
      } catch {
        detectorInstance = null;
      }
    }

    const scanFrame = async () => {
      if (!isScanning) return;

      const video = videoRef.current;
      if (video && video.readyState >= 2 && detectorInstance && !validating) {
        try {
          const barcodes = await detectorInstance.detect(video);
          if (barcodes && barcodes.length > 0) {
            const detectedValue = String(barcodes[0].rawValue ?? '').trim();
            const now = Date.now();
            const last = lastScannedCodeRef.current;

            // Debounce: don't re-scan the same code within 2 seconds
            if (detectedValue && (!last || last.code !== detectedValue || now - last.time > 2000)) {
              lastScannedCodeRef.current = { code: detectedValue, time: now };
              setCode(detectedValue);
              await executeScan(detectedValue);
            }
          }
        } catch {
          // Frame drop or detection error, ignore and continue
        }
      }

      if (isScanning) {
        animFrameRef.current = requestAnimationFrame(scanFrame);
      }
    };

    animFrameRef.current = requestAnimationFrame(scanFrame);

    return () => {
      isScanning = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [cameraActive, hasBarcodeDetector, validating, executeScan]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  return (
    <div>
      <PageHeader
        title="Scanner Barcode & Kamera Gudang"
        subtitle="Validasi fisik produk secara instan saat picking & packing menggunakan pemindai barcode atau kamera HP/laptop"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setSoundEnabled((prev) => !prev)}
              title={soundEnabled ? 'Matikan Suara Beep' : 'Nyalakan Suara Beep'}
            >
              {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
              <span>{soundEnabled ? 'Suara ON' : 'Suara Muted'}</span>
            </button>
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
          </div>
        }
      />

      {loading ? (
        <LoadingState message="Memuat tugas pemindaian barcode..." />
      ) : error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            setLoading(true);
            setError('');
            load();
          }}
        />
      ) : tasks.length === 0 ? (
        <EmptyState
          title="Tidak ada pesanan berstatus Picking"
          description="Buka menu Fulfillment dan klik tombol 'Mulai Picking' pada salah satu pesanan untuk mulai memindai barcode barang."
        />
      ) : (
        <div>
          {/* Order Selector Card */}
          <div className="card mb16">
            <label
              style={{
                display: 'block',
                fontWeight: 600,
                fontSize: 13,
                marginBottom: 8,
                color: 'var(--on-surface)',
              }}
            >
              Pilih Pesanan yang Sedang Dipick
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <select
                className="input grow"
                style={{ height: 42, fontSize: 14, fontWeight: 500 }}
                value={selected?.id ?? ''}
                onChange={(e) => {
                  setSelected(tasks.find((t) => t.id === e.target.value) ?? null);
                  setResult(null);
                }}
              >
                {tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    Order #{t.orderExternalId} ({t.items.length} jenis item)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selected && (
            <div className="grid-2">
              {/* Scanner Section */}
              <div>
                {/* Mode Selector Buttons */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${!cameraActive ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flex: 1, padding: '8px 12px' }}
                    onClick={stopCamera}
                  >
                    <Barcode size={15} />
                    <span>Mode Barcode Fisik</span>
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${cameraActive ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ flex: 1, padding: '8px 12px' }}
                    onClick={startCamera}
                  >
                    <Camera size={15} />
                    <span>Buka Kamera Device</span>
                  </button>
                </div>

                {/* Camera Viewport (Active Mode) */}
                {cameraActive && (
                  <div
                    style={{
                      position: 'relative',
                      background: '#000',
                      borderRadius: 12,
                      overflow: 'hidden',
                      aspectRatio: '4/3',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 16,
                      border: '2px solid var(--primary)',
                    }}
                  >
                    <video
                      ref={videoRef}
                      playsInline
                      autoPlay
                      muted
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />

                    {/* Laser Scanning Overlay */}
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        pointerEvents: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {/* Bounding Box Frame */}
                      <div
                        style={{
                          width: '70%',
                          height: '50%',
                          border: '2px dashed rgba(255,255,255,0.7)',
                          borderRadius: 8,
                          position: 'relative',
                          boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
                        }}
                      >
                        {/* Red Laser Bar Animation */}
                        <div
                          style={{
                            width: '100%',
                            height: 2,
                            background: '#ef4444',
                            boxShadow: '0 0 8px 2px #ef4444',
                            position: 'absolute',
                            animation: 'laserScan 1.8s ease-in-out infinite alternate',
                          }}
                        />
                      </div>
                      <span
                        style={{
                          color: '#fff',
                          fontSize: 11,
                          fontWeight: 600,
                          marginTop: 10,
                          background: 'rgba(0,0,0,0.6)',
                          padding: '2px 8px',
                          borderRadius: 4,
                          textShadow: '0 1px 2px #000',
                        }}
                      >
                        Arahkan kamera tepat ke garis barcode
                      </span>
                    </div>

                    {/* Camera Control Buttons */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        display: 'flex',
                        gap: 8,
                        zIndex: 10,
                      }}
                    >
                      <button
                        type="button"
                        className="btn btn-icon btn-sm"
                        style={{ background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none' }}
                        title="Balik Kamera Depan / Belakang"
                        onClick={() => {
                          setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
                          setTimeout(startCamera, 100);
                        }}
                      >
                        <SwitchCamera size={16} />
                      </button>

                      <button
                        type="button"
                        className="btn btn-icon btn-sm"
                        style={{ background: 'rgba(239, 68, 68, 0.8)', color: '#fff', border: 'none' }}
                        title="Tutup Kamera"
                        onClick={stopCamera}
                      >
                        <CameraOff size={16} />
                      </button>
                    </div>
                  </div>
                )}

                {cameraError && (
                  <div className="mb16">
                    <Alert tone="danger">{cameraError}</Alert>
                  </div>
                )}

                {/* Manual / Barcode Scanner Input Form */}
                <form onSubmit={handleSubmit}>
                  <div
                    className={`scanner-zone ${
                      result?.success ? 'ok' : result?.error ? 'err' : ''
                    }`}
                    style={{ position: 'relative' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                      <span
                        style={{
                          display: 'flex',
                          width: 44,
                          height: 44,
                          borderRadius: '50%',
                          background: result?.success ? 'var(--success-border)' : 'var(--surface-high)',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: result?.success ? 'var(--success)' : 'var(--on-surface-variant)',
                        }}
                      >
                        <Barcode size={22} aria-hidden />
                      </span>
                    </div>

                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: 'var(--on-surface)' }}>
                      Scan Barcode / Masukkan SKU
                    </div>
                    <div className="small muted mb12">
                      Gunakan barcode scanner, kamera, atau ketik SKU/Barcode lalu tekan Enter
                    </div>

                    <input
                      ref={inputRef}
                      className="input"
                      style={{
                        height: 48,
                        fontSize: 16,
                        textAlign: 'center',
                        fontWeight: 700,
                        letterSpacing: '0.05em',
                        borderWidth: 2,
                      }}
                      placeholder="Contoh: 8991000000001 / SHOPEE-..."
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      autoFocus={!cameraActive}
                    />

                    <button
                      type="submit"
                      className="btn btn-primary btn-lg mt12"
                      style={{ width: '100%' }}
                      disabled={!code.trim() || validating}
                    >
                      <ScanLine size={16} aria-hidden />
                      <span>{validating ? 'Memvalidasi...' : 'Konfirmasi Pindaian'}</span>
                    </button>
                  </div>
                </form>

                {/* Scan Feedback Banner */}
                {result && (
                  <div
                    className={`alert ${
                      result.success ? 'alert-success' : 'alert-danger'
                    } mt16`}
                    style={{ borderRadius: 'var(--r-md)', padding: 14 }}
                  >
                    {result.success ? (
                      <CheckCircle2 size={22} aria-hidden style={{ color: 'var(--success)' }} />
                    ) : (
                      <XCircle size={22} aria-hidden style={{ color: 'var(--error)' }} />
                    )}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
                        {result.success ? 'Barang Cocok & Terverifikasi' : 'Pindaian Gagal / Tidak Cocok'}
                      </div>
                      <div style={{ fontSize: 13 }}>
                        {result.success ? (
                          <>
                            SKU <strong>{result.item?.sku}</strong> berhasil dicocokkan. Jumlah terverifikasi:{' '}
                            <strong>
                              {result.item?.pickedQuantity}/{result.item?.expectedQuantity} pcs
                            </strong>
                            .
                          </>
                        ) : (
                          result.error?.message
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Order Items Checklist */}
              <div className="card">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 14,
                  }}
                >
                  <div>
                    <h2 style={{ fontSize: 15, fontWeight: 700 }}>Daftar Kebutuhan Barang</h2>
                    <div className="small muted">Pesanan #{selected.orderExternalId}</div>
                  </div>
                  <span className="badge badge-primary">
                    {selected.items.filter((i) => i.isConfirmed).length}/{selected.items.length} Selesai
                  </span>
                </div>

                <div className="table-wrap">
                  <table className="table" style={{ minWidth: 320 }}>
                    <thead>
                      <tr>
                        <th>SKU / Varian</th>
                        <th className="num">Kebutuhan</th>
                        <th className="num">Dipindai</th>
                        <th style={{ textAlign: 'center', width: 48 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((i) => (
                        <tr
                          key={i.id}
                          style={{
                            background: i.isConfirmed ? 'var(--success-container)' : undefined,
                          }}
                        >
                          <td>
                            <div className="mono" style={{ fontWeight: 700 }}>
                              {i.sku}
                            </div>
                            <div className="small muted">{i.variantName}</div>
                            {i.barcode ? <div className="small mono muted">{i.barcode}</div> : null}
                          </td>
                          <td className="num">
                            <span style={{ fontWeight: 600 }}>{i.expectedQuantity}</span>
                          </td>
                          <td className="num">
                            <span
                              style={{
                                fontWeight: 700,
                                color: i.isConfirmed ? 'var(--success)' : 'var(--primary)',
                              }}
                            >
                              {i.pickedQuantity}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {i.isConfirmed ? (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  width: 24,
                                  height: 24,
                                  borderRadius: '50%',
                                  background: 'var(--success)',
                                  color: '#fff',
                                }}
                              >
                                <Check size={14} strokeWidth={2.5} aria-hidden />
                              </span>
                            ) : (
                              <span style={{ color: 'var(--on-surface-muted)', fontSize: 12 }}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Laser Scanning CSS Animation */}
      <style jsx global>{`
        @keyframes laserScan {
          0% {
            top: 5%;
          }
          100% {
            top: 95%;
          }
        }
      `}</style>
    </div>
  );
}
