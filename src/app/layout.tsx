import type { Metadata } from 'next';
import { Roboto } from 'next/font/google';
import './globals.css';

const roboto = Roboto({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-roboto',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'E-Fulfill Hub — Operasional Fulfillment Shopee',
  description:
    'Platform operasional terintegrasi untuk manajemen pesanan, inventori, picking, packing, pengiriman, dan retur marketplace Shopee.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className={roboto.variable}>{children}</body>
    </html>
  );
}
