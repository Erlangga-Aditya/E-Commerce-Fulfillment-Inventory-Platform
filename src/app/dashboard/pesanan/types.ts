/**
 * Tipe bersama halaman "Pesanan & Pengiriman".
 *
 * Dipisah dari `page.tsx` supaya kartu pesanan bisa dijadikan komponen sendiri
 * (file halaman sudah terlalu besar) tanpa dua definisi tipe yang bisa berbeda.
 */
import type { OperatorStage, OperatorWorkflow } from '@/modules/fulfillment/domain/operator-workflow';

export type Stage = OperatorStage;

export interface OrderItemRow {
  id: string;
  variantId: string;
  sku: string;
  variantName: string;
  productName: string;
  quantity: number;
  fulfilledQuantity: number;
  available: number;
  shortfall: number;
}

export interface StationOrder {
  orderId: string;
  externalOrderId: string;
  buyerName: string | null;
  buyerPhone: string | null;
  shopName: string;
  provider: string;
  placedAt: string;
  shipByAt: string | null;
  priorityLevel: string | null;
  orderStatus: string;
  fulfillmentId: string | null;
  fulfillmentStatus: string | null;
  awb: string | null;
  carrier: string | null;
  /** Keadaan paket menurut catatan kita, untuk penyaring dan kartu ringkasan. */
  shipmentStatus: string | null;
  canArrangeShipment: boolean;
  /** Barang hanya boleh dinyatakan siap kirim setelah nomor resi terbit. */
  canPack: boolean;
  stage: Stage;
  /** Aksi yang boleh ditawarkan — dihitung server dari satu sumber kebenaran. */
  workflow: OperatorWorkflow;
  items: OrderItemRow[];
  totalUnits: number;
  shortfallUnits: number;
}

export interface StationResponse {
  warehouse: { id: string; name: string; code: string } | null;
  sort: 'oldest' | 'newest';
  stages: {
    baru: number;
    menungguStok: number;
    siapDikemas: number;
    siapKirim: number;
    dikirim: number;
    dibatalkan: number;
    selesai: number;
  };
  stage: Stage | null;
  /** Jumlah per keadaan nyata, dihitung server dari SELURUH data. */
  ringkasan: {
    perluDiproses: number;
    belumResi: number;
    sudahResi: number;
    belumDijemput: number;
    diPerjalanan: number;
    sudahSampai: number;
    gagalKirim: number;
    selesai: number;
    dibatalkan: number;
    retur: number;
  };
  orders: StationOrder[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** true bila kandidat terpotong pagar pengaman server; WAJIB diberitahukan. */
  truncated: boolean;
  generatedAt: string;
}

export interface ScanOutcome {
  code:
    | 'PACKED'
    | 'ALREADY_PACKED'
    | 'ALREADY_HANDED_OVER'
    | 'NEEDS_SHIPMENT'
    | 'NEEDS_PICKING'
    | 'WAITING_STOCK'
    | 'NOT_QUEUED'
    | 'CANCELLED'
    | 'ALREADY_DELIVERED'
    | 'EXCEPTION'
    | 'NOT_FOUND';
  message: string;
  stockDeducted: boolean;
  deductedUnits: number;
  needsConfirmation: 'PICKING' | 'NEGATIVE_STOCK' | null;
  shortfalls: Array<{ sku: string; productName: string; required: number; available: number; missing: number }>;
  order: { id: string; externalOrderId: string; canPrintOfficialLabel: boolean } | null;
}

export const STAGE_LABEL: Record<Stage, string> = {
  BARU: 'Pesanan Baru',
  MENUNGGU_STOK: 'Menunggu Stok',
  SIAP_DIKEMAS: 'Siap Dikemas',
  SIAP_KIRIM: 'Siap Kirim',
  DIKIRIM: 'Sudah Dikirim',
  DIBATALKAN: 'Dibatalkan',
  SELESAI: 'Selesai',
};

export const STAGE_TONE: Record<Stage, string> = {
  BARU: 'var(--warning)',
  MENUNGGU_STOK: 'var(--danger)',
  SIAP_DIKEMAS: 'var(--secondary)',
  SIAP_KIRIM: 'var(--success)',
  DIKIRIM: 'var(--info)',
  DIBATALKAN: 'var(--danger)',
  SELESAI: 'var(--success)',
};
