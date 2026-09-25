'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Keyboard, ScanLine, Volume2, VolumeX } from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

/**
 * Komponen scan kode (resid/nomor pesanan) yang bisa dipakai di semua perangkat:
 *  - Alat scan laser/USB  → terbaca sebagai ketikan keyboard + Enter.
 *  - Kamera HP/laptop    → memakai mesin pembaca:
 *      a) BarcodeDetector bawaan browser kalau ada (paling cepat), atau
 *      b) ZXing (cadangan) supaya kamera tetap jalan di Chrome desktop/Safari
 *         yang belum punya BarcodeDetector.
 *  - Ketik manual        → kalau kamera tidak diizinkan atau alat scan tidak ada.
 *
 * Umpan balik suara + getar dipanggil lewat playScanFeedback(true/false).
 */

/** Umpan balik suara + getar. */
export function playScanFeedback(ok: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctx) {
      const ctx = new Ctx();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      if (ok) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18);
        osc.connect(gain);
        osc.start();
        osc.stop(ctx.currentTime + 0.18);
      } else {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        gain.gain.setValueAtTime(0.22, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.28);
        osc.connect(gain);
        osc.start();
        osc.stop(ctx.currentTime + 0.28);
      }
    }
    navigator.vibrate?.(ok ? [70] : [140, 60, 140]);
  } catch {
    // Audio bisa diblokir sebelum interaksi pertama — abaikan.
  }
}

type Engine = 'native' | 'zxing';

interface BarcodeScannerProps {
  onScan: (code: string) => void | Promise<void>;
  label?: string;
  placeholder?: string;
  hint?: string;
  submitLabel?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  withSound?: boolean;
  /** Buka kamera otomatis begitu komponen tampil (butuh izin kamera). */
  autoStartCamera?: boolean;
}

const FORMATS_NATIVE = ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e', 'itf'];
const FORMATS_ZXING = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
];

export function BarcodeScanner({
  onScan,
  label = 'Scan barcode',
  placeholder = 'Scan atau ketik kode lalu Enter',
  hint,
  submitLabel = 'Proses',
  disabled = false,
  autoFocus = true,
  withSound = true,
  autoStartCamera = false,
}: BarcodeScannerProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [soundOn, setSoundOn] = useState(true);

  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraNote, setCameraNote] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [engine, setEngine] = useState<Engine>('zxing');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const zxingControlsRef = useRef<{ stop: () => void } | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number } | null>(null);
  const onScanRef = useRef(onScan);
  const withSoundRef = useRef(withSound && soundOn);

  // Simpan callback & pengaturan suara terbaru tanpa memicu render.
  useEffect(() => {
    onScanRef.current = onScan;
    withSoundRef.current = withSound && soundOn;
  }, [onScan, withSound, soundOn]);

  // Cek dukungan kamera (dijalankan setelah render supaya tidak memicu render berantai).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const supported =
        typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
      setCameraSupported(supported);

      // Jelaskan alasannya kalau kamera tidak tersedia — jangan hilang tanpa keterangan.
      if (!supported) {
        const tidakAman = typeof window !== 'undefined' && window.isSecureContext === false;
        setCameraNote(
          tidakAman
            ? 'Kamera hanya bisa dipakai lewat alamat HTTPS. Buka aplikasi memakai alamat https:// Anda, atau pakai alat scan barcode USB / ketik manual.'
            : 'Peramban ini tidak menyediakan akses kamera. Pakai alat scan barcode USB atau ketik manual.',
        );
      } else {
        setCameraNote(null);
      }

      // Cek apakah BarcodeDetector bawaan benar-benar bisa dipakai (bukan hanya ada).
      let nativeUsable = false;
      if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
        try {
          const BD = (window as unknown as { BarcodeDetector: new (opts?: { formats: string[] }) => unknown })
            .BarcodeDetector;
          new BD({ formats: FORMATS_NATIVE });
          nativeUsable = true;
        } catch {
          nativeUsable = false;
        }
      }
      setEngine(nativeUsable ? 'native' : 'zxing');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (autoFocus) setTimeout(() => inputRef.current?.focus(), 150);
  }, [autoFocus]);

  const submit = useCallback(
    async (raw?: string) => {
      const code = (raw ?? value).trim();
      if (!code || busy || disabled) return;
      setBusy(true);
      try {
        await onScanRef.current(code);
        setValue('');
      } finally {
        setBusy(false);
        if (autoFocus) setTimeout(() => inputRef.current?.focus(), 120);
      }
    },
    [value, busy, disabled, autoFocus],
  );
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  }, [submit]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try {
      zxingControlsRef.current?.stop();
    } catch {
      // sudah berhenti
    }
    zxingControlsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    // Tidak men-set state di sini: fungsi ini juga dipanggil dari cleanup effect.
  }, []);

  const startCamera = useCallback(async () => {
    // Keluar dari jalur sinkron lebih dulu: efek React tidak boleh memanggil setState
    // secara langsung (aturan react-hooks/set-state-in-effect).
    await Promise.resolve();
    setCameraError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Peramban ini tidak mendukung kamera. Pakai alat scan laser atau ketik manual.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      // PENTING: elemen <video> baru muncul setelah render pertama dengan
      // cameraActive=true. Karena itu videonya SELALU dirender (walau transparan
      // saat kamera belum aktif), lalu stream langsung dipasang di sini. Dulu
      // stream ini hilang karena videoRef.current masih null saat tombol pertama
      // diklik, sehingga kamera tampak "tidak muncul" (layar gelap).
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch {
          // Beberapa peramban menolak play() otomatis; video tetap menampilkan
          // gambar begitu pengguna menyentuh layar. Aman diabaikan.
        }
      }
      setCameraActive(true);
    } catch (err) {
      const name = (err as Error).name;
      setCameraError(
        name === 'NotAllowedError'
          ? 'Izin kamera ditolak. Izinkan akses kamera di peramban, atau pakai alat scan laser / input manual.'
          : name === 'NotFoundError'
            ? 'Kamera tidak ditemukan di perangkat ini. Pakai alat scan laser atau ketik manual.'
            : `Gagal mengakses kamera: ${(err as Error).message}`,
      );
      setCameraActive(false);
    }
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // Pasang stream ke elemen <video> setiap kali elemen itu baru muncul/timpa.
  // Render video selalu ada (lihat JSX di bawah), jadi ref ini selalu terisi
  // pada klik pertama maupun klik berikutnya.
  useEffect(() => {
    if (!cameraActive) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play().catch(() => {
        // diabaikan: play() otomatis bisa ditolak
      });
    }
  }, [cameraActive]);

  // Buka kamera otomatis bila diminta (hanya sekali, dan hanya kalau didukung).
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStartCamera || !cameraSupported || autoStartedRef.current) return;
    autoStartedRef.current = true;
    const timer = setTimeout(() => void startCamera(), 300);
    return () => clearTimeout(timer);
  }, [autoStartCamera, cameraSupported, startCamera]);

  /** Satu pintu masuk hasil pembacaan: cegah kode yang sama terproses berkali-kali. */
  const handleDetected = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    const last = lastCodeRef.current;
    if (last && last.code === code && now - last.at < 2500) return;
    lastCodeRef.current = { code, at: now };
    if (withSoundRef.current) playScanFeedback(true);
    await submitRef.current(code);
  }, []);

  // Mesin pembaca A: BarcodeDetector bawaan browser.
  useEffect(() => {
    if (!cameraActive || engine !== 'native' || typeof window === 'undefined') return;
    type Detector = { detect: (src: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };
    let detector: Detector;
    try {
      const BD = (window as unknown as { BarcodeDetector: new (opts?: { formats: string[] }) => Detector })
        .BarcodeDetector;
      detector = new BD({ formats: FORMATS_NATIVE });
    } catch {
      // Tidak bisa dibuat (sudah dijaga saat pengecekan dukungan) — hentikan loop ini saja.
      return;
    }

    let running = true;
    const tick = async () => {
      if (!running) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2) {
        try {
          const codes = await detector.detect(video);
          const raw = codes[0]?.rawValue;
          if (raw) await handleDetected(raw);
        } catch {
          // frame gagal dibaca — lanjut ke frame berikutnya
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [cameraActive, engine, handleDetected]);

  // Mesin pembaca B: ZXing (cadangan untuk browser tanpa BarcodeDetector).
  useEffect(() => {
    if (!cameraActive || engine !== 'zxing') return;
    const video = videoRef.current;
    if (!video) return;

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS_ZXING);
    const reader = new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: 180,
      delayBetweenScanSuccess: 900,
    });

    let stopped = false;
    reader
      .decodeFromVideoElement(video, (result) => {
        if (stopped || !result) return;
        void handleDetected(result.getText());
      })
      .then((controls) => {
        if (stopped) {
          controls.stop();
          return;
        }
        zxingControlsRef.current = controls;
      })
      .catch((err: unknown) => {
        if (stopped) return;
        setCameraError(`Kamera tidak bisa membaca kode: ${(err as Error).message}`);
      });

    return () => {
      stopped = true;
      try {
        zxingControlsRef.current?.stop();
      } catch {
        // sudah berhenti
      }
      zxingControlsRef.current = null;
    };
  }, [cameraActive, engine, handleDetected]);

  return (
    <div>
      {label ? (
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{label}</label>
      ) : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
          <Keyboard
            size={15}
            aria-hidden
            style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}
          />
          <input
            ref={inputRef}
            className="input mono"
            style={{ paddingLeft: 32 }}
            value={value}
            placeholder={placeholder}
            disabled={disabled || busy}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
          />
        </div>

        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || busy || !value.trim()}
          onClick={() => void submit()}
        >
          <ScanLine size={15} aria-hidden />
          <span>{busy ? 'Memproses...' : submitLabel}</span>
        </button>

        {cameraSupported && (
          <button
            type="button"
            className={cameraActive ? 'btn btn-secondary' : 'btn btn-secondary'}
            disabled={disabled}
            onClick={() => {
              if (cameraActive) {
                stopCamera();
                setCameraActive(false);
              } else {
                void startCamera();
              }
            }}
          >
            {cameraActive ? <CameraOff size={15} aria-hidden /> : <Camera size={15} aria-hidden />}
            <span>{cameraActive ? 'Matikan Kamera' : 'Scan dengan Kamera'}</span>
          </button>
        )}

        {withSound && (
          <button
            type="button"
            className="btn btn-ghost"
            title={soundOn ? 'Suara aktif' : 'Suara mati'}
            onClick={() => setSoundOn((v) => !v)}
          >
            {soundOn ? <Volume2 size={15} aria-hidden /> : <VolumeX size={15} aria-hidden />}
          </button>
        )}
      </div>

      {hint ? (
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          {hint}
        </p>
      ) : null}

      {!cameraSupported && cameraNote ? (
        <p className="small" style={{ margin: '8px 0 0', color: 'var(--warning, #b45309)' }}>
          {cameraNote}
        </p>
      ) : null}

      {cameraError ? (
        <p className="small" style={{ margin: '8px 0 0', color: 'var(--danger)' }}>
          {cameraError}
        </p>
      ) : null}

      {/*
        Elemen video SELALU dirender (hanya disembunyikan lewat style saat kamera
        belum aktif). Kalau video baru dibuat setelah kamera menyala, ref-nya
        masih null saat stream diperoleh sehingga gambar tidak pernah muncul.
        Render selalu + style bersembunyi = ref selalu terisi, dan tidak ada
        elemen yang menggeser tata letak karena wrapper-nya tetap berukuran tetap.
      */}
      <div
        aria-hidden={!cameraActive}
        style={{
          marginTop: 10,
          position: 'relative',
          borderRadius: 12,
          overflow: 'hidden',
          background: '#0f172a',
          // Sembunyikan hanya isinya; elemen video tetap ada di DOM.
          visibility: cameraActive ? 'visible' : 'hidden',
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={{ width: '100%', maxHeight: 260, display: 'block' }}
        />
        {cameraActive ? (
          <>
            <div
              style={{
                position: 'absolute',
                inset: '18% 12%',
                border: '2px solid rgba(255,255,255,0.85)',
                borderRadius: 10,
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                left: 0,
                right: 0,
                textAlign: 'center',
                color: '#fff',
                fontSize: 12,
                opacity: 0.9,
              }}
            >
              Arahkan kamera ke barcode resi di dalam kotak
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
