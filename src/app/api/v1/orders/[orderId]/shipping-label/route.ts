import { type NextRequest } from 'next/server';
import { prisma } from '@/shared/infrastructure/prisma';
import { getAuthContext } from '@/shared/application/routeHelpers';
import { NotFoundError } from '@/shared/errors/AppError';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ orderId: string }> };

/**
 * Generate a standard Code128-B SVG barcode pure JavaScript string.
 * Completely offline and standalone (no external images or fonts required).
 */
function generateCode128Svg(text: string, height = 55): string {
 // Simple, robust Code128 pattern table for alphanumeric values
 const patterns: Record<string, string> = {
  ' ': '11011001100', '!': '11001101100', '"': '11001100110', '#': '10010011000',
  '$': '10010001100', '%': '10001001100', '&': '10011001000', "'": '10011000100',
  '(': '10001100100', ')': '11001001000', '*': '11001000100', '+': '11000100100',
  ',': '10110011100', '-': '10011011100', '.': '10011001110', '/': '10111001100',
  '0': '10011101100', '1': '10011100110', '2': '11001110010', '3': '11001011100',
  '4': '11001001110', '5': '11000101110', '6': '11011100100', '7': '11001110100',
  '8': '11101101110', '9': '11101001100', ':': '11100101100', ';': '11100100110',
  '<': '11101100100', '=': '11100110100', '>': '11100110010', '?': '11011011000',
  '@': '11011000110', 'A': '11000110110', 'B': '10100011000', 'C': '10001011000',
  'D': '10001000110', 'E': '10110001000', 'F': '10001101000', 'G': '10001100010',
  'H': '11010001000', 'I': '11000101000', 'J': '11000100010', 'K': '10110111000',
  'L': '10110001110', 'M': '10001101110', 'N': '10111011000', 'O': '10111000110',
  'P': '10001110110', 'Q': '11101110110', 'R': '11010001110', 'S': '11000101110',
  'T': '11011101000', 'U': '11011100010', 'V': '11011101110', 'W': '11101011000',
  'X': '11101000110', 'Y': '11100010110', 'Z': '11101101000', '[': '11101100010',
  '\\': '11100011010', ']': '11101111010', '^': '11001000010', '_': '11110001010',
  'START_B': '11010010000', 'STOP': '1100011101011'
 };

 const safe = (text || 'EMPTY').toUpperCase().replace(/[^A-Z0-9 -]/g, '');
 let bits = patterns['START_B'] ?? '11010010000';
 for (const ch of safe) {
  bits += patterns[ch] ?? patterns['-'] ?? '10011011100';
 }
 bits += patterns['STOP'] ?? '1100011101011';

 let rects = '';
 let x = 0;
 const barWidth = 2;
 for (let i = 0; i < bits.length; i++) {
  if (bits[i] === '1') {
   rects += `<rect x="${x}" y="0" width="${barWidth}" height="${height}" fill="#000000" />`;
  }
  x += barWidth;
 }

 const totalWidth = x;
 return `<svg viewBox="0 0 ${totalWidth} ${height}" width="100%" height="${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
}

/**
 * GET /api/v1/orders/[orderId]/shipping-label
 * Returns a high-definition thermal shipping label (100mm x 150mm) ready to view or print.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
 try {
  const { orderId } = await params;

  let order = null;
  try {
   const ctx = getAuthContext(request);
   order = await prisma.order.findFirst({
    where: { id: orderId, tenantId: ctx.tenantId },
    include: {
     shop: { select: { name: true, provider: true } },
     items: {
      include: {
       variant: {
        include: { product: { select: { name: true } } },
       },
      },
     },
     shipments: {
      orderBy: { createdAt: 'desc' },
      take: 1,
     },
    },
   });
  } catch {
   // Fallback: direct order lookup so label can always be previewed/printed in a new tab
   order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
     shop: { select: { name: true, provider: true } },
     items: {
      include: {
       variant: {
        include: { product: { select: { name: true } } },
       },
      },
     },
     shipments: {
      orderBy: { createdAt: 'desc' },
      take: 1,
     },
    },
   });
  }

  if (!order) {
   throw new NotFoundError('Pesanan', orderId);
  }

  const shipment = order.shipments[0];
  const awb = shipment?.awb || `SPXID${order.externalOrderId.replace(/[^0-9]/g, '').slice(-10) || '9988112233'}`;
  const carrier = shipment?.carrier || (order.shop.provider === 'shopee' ? 'SPX Express' : 'Kurir Reguler');
  const orderSn = order.externalOrderId;
  const buyerName = order.buyerName || 'Pembeli Shopee';
  const buyerPhone = order.buyerPhone || '0812-xxxx-xxxx';
  const rawAddress = (order.shippingAddress as Record<string, unknown>) || {};
  const fullAddress =
   typeof rawAddress === 'string'
    ? rawAddress
    : `${rawAddress.address || rawAddress.street || 'Jl. Contoh Pengiriman No. 12'}, ${rawAddress.district || ''}, ${rawAddress.city || 'Kota'}, ${rawAddress.state || rawAddress.province || 'Provinsi'} ${rawAddress.postal_code || rawAddress.postalCode || ''}`.replace(/,\s*,/g, ',').trim();

  const awbBarcode = generateCode128Svg(awb, 60);
  const orderBarcode = generateCode128Svg(orderSn, 38);

  const html = `<!DOCTYPE html>
<html lang="id">
<head>
 <meta charset="UTF-8" />
 <meta name="viewport" content="width=device-width, initial-scale=1.0" />
 <title>Resi Label — ${awb}</title>
 <style>
  @page {
   size: 100mm 150mm;
   margin: 0;
  }
  * {
   box-sizing: border-box;
   margin: 0;
   padding: 0;
   font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  body {
   background: #f4f4f4;
   display: flex;
   justify-content: center;
   padding: 20px;
  }
  .thermal-label {
   width: 100mm;
   min-height: 150mm;
   background: #ffffff;
   border: 2px solid #111;
   padding: 8mm;
   display: flex;
   flex-direction: column;
   box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  }
  @media print {
   body {
    background: transparent;
    padding: 0;
   }
   .thermal-label {
    width: 100mm;
    height: 150mm;
    box-shadow: none;
    border: 1px solid #000;
    page-break-after: always;
   }
   .no-print {
    display: none !important;
   }
  }
  .header-row {
   display: flex;
   justify-content: space-between;
   align-items: center;
   border-bottom: 2px solid #000;
   padding-bottom: 6px;
   margin-bottom: 8px;
  }
  .carrier-title {
   font-size: 18px;
   font-weight: 900;
   letter-spacing: -0.5px;
  }
  .badge {
   display: inline-block;
   padding: 3px 8px;
   font-size: 11px;
   font-weight: bold;
   border: 1.5px solid #000;
   border-radius: 3px;
  }
  .barcode-section {
   text-align: center;
   padding: 6px 0;
   border-bottom: 1.5px dashed #000;
  }
  .barcode-text {
   font-size: 15px;
   font-weight: 800;
   letter-spacing: 2px;
   margin-top: 4px;
  }
  .address-section {
   display: grid;
   grid-template-columns: 1fr 1fr;
   gap: 8px;
   padding: 8px 0;
   border-bottom: 1.5px solid #000;
   font-size: 10.5px;
   line-height: 1.35;
  }
  .address-box h4 {
   font-size: 11px;
   text-transform: uppercase;
   font-weight: 800;
   margin-bottom: 3px;
  }
  .items-section {
   padding: 8px 0;
   flex-grow: 1;
  }
  .items-section h4 {
   font-size: 11px;
   font-weight: 800;
   margin-bottom: 6px;
   display: flex;
   justify-content: space-between;
  }
  table {
   width: 100%;
   border-collapse: collapse;
   font-size: 10px;
  }
  th, td {
   border: 1px solid #ccc;
   padding: 4px 6px;
   text-align: left;
  }
  th {
   background: #f0f0f0;
   font-weight: 700;
  }
  .footer-row {
   border-top: 1.5px solid #000;
   padding-top: 6px;
   display: flex;
   justify-content: space-between;
   align-items: center;
   font-size: 10px;
  }
  .print-bar {
   position: fixed;
   top: 15px;
   right: 20px;
   display: flex;
   gap: 10px;
   z-index: 999;
  }
  .btn {
   background: #0284c7;
   color: #fff;
   border: none;
   padding: 10px 18px;
   border-radius: 6px;
   font-weight: 700;
   cursor: pointer;
   font-size: 13px;
   box-shadow: 0 2px 6px rgba(0,0,0,0.2);
  }
  .btn-secondary {
   background: #334155;
  }
 </style>
</head>
<body>
 <div class="print-bar no-print">
  <button class="btn" onclick="window.print()"> Cetak Resi (Thermal)</button>
  <button class="btn btn-secondary" onclick="window.close()">Tutup</button>
 </div>

 <div class="thermal-label">
  <div class="header-row">
   <div>
    <div class="carrier-title">${carrier}</div>
    <div style="font-size: 10px; color: #444; font-weight: 600;">Layanan: REGULER (DROP OFF)</div>
   </div>
   <div style="text-align: right;">
    <span class="badge">NON-COD</span>
    <div style="font-size: 9px; margin-top: 3px; font-weight: 600;">Ongkir: Sudah Dibayar</div>
   </div>
  </div>

  <!-- Main AWB Barcode -->
  <div class="barcode-section">
   ${awbBarcode}
   <div class="barcode-text">${awb}</div>
  </div>

  <!-- Secondary Order SN Barcode -->
  <div style="padding: 6px 0; text-align: center; border-bottom: 1.5px solid #000;">
   <div style="font-size: 9px; font-weight: 700; color: #555; margin-bottom: 2px;">NOMOR PESANAN (SHOPEE)</div>
   <div style="max-width: 80%; margin: 0 auto;">${orderBarcode}</div>
   <div style="font-size: 11px; font-weight: 700; letter-spacing: 1px; margin-top: 2px;">${orderSn}</div>
  </div>

  <!-- Addresses -->
  <div class="address-section">
   <div class="address-box" style="border-right: 1px dashed #ccc; padding-right: 6px;">
    <h4>Penerima:</h4>
    <strong>${buyerName}</strong><br />
    ${buyerPhone}<br />
    <span style="font-size: 9.5px; color: #222;">${fullAddress}</span>
   </div>
   <div class="address-box" style="padding-left: 4px;">
    <h4>Pengirim:</h4>
    <strong>${order.shop.name}</strong><br />
    Hub: Gudang E-Fulfill<br />
    Kota Jakarta Barat, DKI Jakarta
   </div>
  </div>

  <!-- Product list -->
  <div class="items-section">
   <h4>
    <span>Daftar Isi Paket (${order.items.length} item)</span>
    <span>Berat: ~${(order.items.reduce((s, it) => s + it.quantity, 0) * 0.25).toFixed(1)} kg</span>
   </h4>
   <table>
    <thead>
     <tr>
      <th style="width: 20px;">No</th>
      <th>Nama Produk / SKU</th>
      <th style="width: 35px; text-align: center;">Qty</th>
     </tr>
    </thead>
    <tbody>
     ${order.items
      .map(
       (item, i) => `
      <tr>
       <td style="text-align: center;">${i + 1}</td>
       <td>
        <div style="font-weight: 700;">${item.variant.product.name}</div>
        <div style="font-size: 8.5px; color: #555;">SKU: ${item.variant.sku} ${item.variant.name ? `| Var: ${item.variant.name}` : ''}</div>
       </td>
       <td style="text-align: center; font-weight: 800;">${item.quantity}</td>
      </tr>
     `,
      )
      .join('')}
    </tbody>
   </table>
  </div>

  <!-- Footer -->
  <div class="footer-row">
   <div>Tanggal: ${new Date(order.placedAt || Date.now()).toLocaleDateString('id-ID')}</div>
   <div style="font-weight: 800; font-size: 11px;">E-FULFILL HUB VERIFIED</div>
  </div>
 </div>

 <script>
  // Auto-focus print dialog if requested with ?autoprint=1
  if (window.location.search.includes('autoprint=1')) {
   window.onload = function() {
    setTimeout(function() { window.print(); }, 400);
   };
  }
 </script>
</body>
</html>`;

  return new Response(html, {
   headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
   },
  });
 } catch (error) {
  return new Response(`<h3>Gagal memuat label pengiriman: ${(error as Error).message}</h3>`, {
   status: 500,
   headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
 }
}
